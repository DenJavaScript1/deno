// Copyright 2018-2024 the Deno authors. All rights reserved. MIT license.

use deno_ast::swc::ast;
use deno_ast::swc::atoms::Atom;
use deno_ast::swc::common::comments::CommentKind;
use deno_ast::swc::common::DUMMY_SP;
use deno_ast::swc::visit::as_folder;
use deno_ast::swc::visit::FoldWith as _;
use deno_ast::swc::visit::Visit;
use deno_ast::swc::visit::VisitMut;
use deno_ast::swc::visit::VisitWith as _;
use deno_ast::MediaType;
use deno_ast::SourceRangedForSpanned as _;
use deno_core::error::AnyError;
use deno_core::ModuleSpecifier;
use regex::Regex;
use std::fmt::Write as _;
use std::sync::Arc;

use crate::file_fetcher::File;
use crate::util::path::mapped_specifier_for_tsc;

/// Extracts doc tests from a given file, transforms them into pseudo test
/// files by wrapping the content of the doc tests in a `Deno.test` call, and
/// returns a list of the pseudo test files.
pub(super) fn extract_doc_tests(file: File) -> Result<Vec<File>, AnyError> {
  let file = file.into_text_decoded()?;

  let exports = match deno_ast::parse_program(deno_ast::ParseParams {
    specifier: file.specifier.clone(),
    text: file.source.clone(),
    media_type: file.media_type,
    capture_tokens: false,
    scope_analysis: false,
    maybe_syntax: None,
  }) {
    Ok(parsed) => {
      let mut c = ExportCollector::default();
      c.visit_program(parsed.program_ref());
      c
    }
    Err(_) => ExportCollector::default(),
  };

  let extracted_files = if file.media_type == MediaType::Unknown {
    extract_files_from_fenced_blocks(
      &file.specifier,
      &file.source,
      file.media_type,
    )?
  } else {
    extract_files_from_source_comments(
      &file.specifier,
      file.source.clone(),
      file.media_type,
    )?
  };

  extracted_files
    .into_iter()
    .map(|extracted_file| {
      generate_pseudo_test_file(extracted_file, &file.specifier, &exports)
    })
    .collect::<Result<_, _>>()
}

fn extract_files_from_fenced_blocks(
  specifier: &ModuleSpecifier,
  source: &str,
  media_type: MediaType,
) -> Result<Vec<File>, AnyError> {
  // The pattern matches code blocks as well as anything in HTML comment syntax,
  // but it stores the latter without any capturing groups. This way, a simple
  // check can be done to see if a block is inside a comment (and skip typechecking)
  // or not by checking for the presence of capturing groups in the matches.
  let blocks_regex =
    lazy_regex::regex!(r"(?s)<!--.*?-->|```([^\r\n]*)\r?\n([\S\s]*?)```");
  let lines_regex = lazy_regex::regex!(r"(?:\# ?)?(.*)");

  extract_files_from_regex_blocks(
    specifier,
    source,
    media_type,
    /* file line index */ 0,
    blocks_regex,
    lines_regex,
  )
}

fn extract_files_from_source_comments(
  specifier: &ModuleSpecifier,
  source: Arc<str>,
  media_type: MediaType,
) -> Result<Vec<File>, AnyError> {
  let parsed_source = deno_ast::parse_module(deno_ast::ParseParams {
    specifier: specifier.clone(),
    text: source,
    media_type,
    capture_tokens: false,
    maybe_syntax: None,
    scope_analysis: false,
  })?;
  let comments = parsed_source.comments().get_vec();
  let blocks_regex = lazy_regex::regex!(r"```([^\r\n]*)\r?\n([\S\s]*?)```");
  let lines_regex = lazy_regex::regex!(r"(?:\* ?)(?:\# ?)?(.*)");

  let files = comments
    .iter()
    .filter(|comment| {
      if comment.kind != CommentKind::Block || !comment.text.starts_with('*') {
        return false;
      }

      true
    })
    .flat_map(|comment| {
      extract_files_from_regex_blocks(
        specifier,
        &comment.text,
        media_type,
        parsed_source.text_info_lazy().line_index(comment.start()),
        blocks_regex,
        lines_regex,
      )
    })
    .flatten()
    .collect();

  Ok(files)
}

fn extract_files_from_regex_blocks(
  specifier: &ModuleSpecifier,
  source: &str,
  media_type: MediaType,
  file_line_index: usize,
  blocks_regex: &Regex,
  lines_regex: &Regex,
) -> Result<Vec<File>, AnyError> {
  let files = blocks_regex
    .captures_iter(source)
    .filter_map(|block| {
      block.get(1)?;

      let maybe_attributes: Option<Vec<_>> = block
        .get(1)
        .map(|attributes| attributes.as_str().split(' ').collect());

      let file_media_type = if let Some(attributes) = maybe_attributes {
        if attributes.contains(&"ignore") {
          return None;
        }

        match attributes.first() {
          Some(&"js") => MediaType::JavaScript,
          Some(&"javascript") => MediaType::JavaScript,
          Some(&"mjs") => MediaType::Mjs,
          Some(&"cjs") => MediaType::Cjs,
          Some(&"jsx") => MediaType::Jsx,
          Some(&"ts") => MediaType::TypeScript,
          Some(&"typescript") => MediaType::TypeScript,
          Some(&"mts") => MediaType::Mts,
          Some(&"cts") => MediaType::Cts,
          Some(&"tsx") => MediaType::Tsx,
          _ => MediaType::Unknown,
        }
      } else {
        media_type
      };

      if file_media_type == MediaType::Unknown {
        return None;
      }

      let line_offset = source[0..block.get(0).unwrap().start()]
        .chars()
        .filter(|c| *c == '\n')
        .count();

      let line_count = block.get(0).unwrap().as_str().split('\n').count();

      let body = block.get(2).unwrap();
      let text = body.as_str();

      // TODO(caspervonb) generate an inline source map
      let mut file_source = String::new();
      for line in lines_regex.captures_iter(text) {
        let text = line.get(1).unwrap();
        writeln!(file_source, "{}", text.as_str()).unwrap();
      }

      let file_specifier = ModuleSpecifier::parse(&format!(
        "{}${}-{}",
        specifier,
        file_line_index + line_offset + 1,
        file_line_index + line_offset + line_count + 1,
      ))
      .unwrap();
      let file_specifier =
        mapped_specifier_for_tsc(&file_specifier, file_media_type)
          .map(|s| ModuleSpecifier::parse(&s).unwrap())
          .unwrap_or(file_specifier);

      Some(File {
        specifier: file_specifier,
        maybe_headers: None,
        source: file_source.into_bytes().into(),
      })
    })
    .collect();

  Ok(files)
}

#[derive(Default)]
struct ExportCollector {
  named_exports: Vec<Atom>,
  default_export: Option<Atom>,
}

impl ExportCollector {
  fn to_import_specifiers(&self) -> Vec<ast::ImportSpecifier> {
    let mut import_specifiers = vec![];
    if let Some(default_export) = &self.default_export {
      import_specifiers.push(ast::ImportSpecifier::Default(
        ast::ImportDefaultSpecifier {
          span: DUMMY_SP,
          local: ast::Ident {
            span: DUMMY_SP,
            ctxt: Default::default(),
            sym: default_export.clone(),
            optional: false,
          },
        },
      ));
    }
    for named_export in &self.named_exports {
      import_specifiers.push(ast::ImportSpecifier::Named(
        ast::ImportNamedSpecifier {
          span: DUMMY_SP,
          local: ast::Ident {
            span: DUMMY_SP,
            ctxt: Default::default(),
            sym: named_export.clone(),
            optional: false,
          },
          imported: None,
          is_type_only: false,
        },
      ));
    }
    import_specifiers
  }
}

impl Visit for ExportCollector {
  fn visit_ts_module_decl(&mut self, ts_module_decl: &ast::TsModuleDecl) {
    if ts_module_decl.declare {
      return;
    }
  }

  fn visit_export_decl(&mut self, export_decl: &ast::ExportDecl) {
    match &export_decl.decl {
      ast::Decl::Class(class) => {
        self.named_exports.push(class.ident.sym.clone());
      }
      ast::Decl::Fn(func) => {
        self.named_exports.push(func.ident.sym.clone());
      }
      ast::Decl::Var(var) => {
        for var_decl in &var.decls {
          let atoms = extract_sym_from_pat(&var_decl.name);
          self.named_exports.extend(atoms);
        }
      }
      ast::Decl::TsEnum(ts_enum) => {
        self.named_exports.push(ts_enum.id.sym.clone());
      }
      ast::Decl::TsModule(ts_module) => {
        if ts_module.declare {
          return;
        }

        match &ts_module.id {
          ast::TsModuleName::Ident(ident) => {
            self.named_exports.push(ident.sym.clone());
          }
          ast::TsModuleName::Str(s) => {
            self.named_exports.push(s.value.clone());
          }
        }
      }
      ast::Decl::TsTypeAlias(ts_type_alias) => {
        self.named_exports.push(ts_type_alias.id.sym.clone());
      }
      ast::Decl::TsInterface(ts_interface) => {
        self.named_exports.push(ts_interface.id.sym.clone());
      }
      ast::Decl::Using(_) => {}
    }
  }

  fn visit_export_default_decl(
    &mut self,
    export_default_decl: &ast::ExportDefaultDecl,
  ) {
    match &export_default_decl.decl {
      ast::DefaultDecl::Class(class) => {
        if let Some(ident) = &class.ident {
          self.default_export = Some(ident.sym.clone());
        }
      }
      ast::DefaultDecl::Fn(func) => {
        if let Some(ident) = &func.ident {
          self.default_export = Some(ident.sym.clone());
        }
      }
      ast::DefaultDecl::TsInterfaceDecl(_) => {}
    }
  }

  fn visit_export_named_specifier(
    &mut self,
    export_named_specifier: &ast::ExportNamedSpecifier,
  ) {
    fn get_atom(export_name: &ast::ModuleExportName) -> Atom {
      match export_name {
        ast::ModuleExportName::Ident(ident) => ident.sym.clone(),
        ast::ModuleExportName::Str(s) => s.value.clone(),
      }
    }

    match &export_named_specifier.exported {
      Some(exported) => {
        self.named_exports.push(get_atom(exported));
      }
      None => {
        self
          .named_exports
          .push(get_atom(&export_named_specifier.orig));
      }
    }
  }

  fn visit_named_export(&mut self, named_export: &ast::NamedExport) {
    // ExportCollector does not handle re-exports
    if named_export.src.is_some() {
      return;
    }

    named_export.visit_children_with(self);
  }
}

fn extract_sym_from_pat(pat: &ast::Pat) -> Vec<Atom> {
  fn rec(pat: &ast::Pat, atoms: &mut Vec<Atom>) {
    match pat {
      ast::Pat::Ident(binding_ident) => {
        atoms.push(binding_ident.sym.clone());
      }
      ast::Pat::Array(array_pat) => {
        for elem in array_pat.elems.iter().flatten() {
          rec(elem, atoms);
        }
      }
      ast::Pat::Rest(rest_pat) => {
        rec(&rest_pat.arg, atoms);
      }
      ast::Pat::Object(object_pat) => {
        for prop in &object_pat.props {
          match prop {
            ast::ObjectPatProp::Assign(assign_pat_prop) => {
              atoms.push(assign_pat_prop.key.sym.clone());
            }
            ast::ObjectPatProp::KeyValue(key_value_pat_prop) => {
              rec(&key_value_pat_prop.value, atoms);
            }
            ast::ObjectPatProp::Rest(rest_pat) => {
              rec(&rest_pat.arg, atoms);
            }
          }
        }
      }
      ast::Pat::Assign(assign_pat) => {
        rec(&assign_pat.left, atoms);
      }
      ast::Pat::Invalid(_) | ast::Pat::Expr(_) => {}
    }
  }

  let mut atoms = vec![];
  rec(pat, &mut atoms);
  atoms
}

/// Generates a "pseudo" test file from a given file by applying the following
/// transformations:
///
/// 1. Injects `import` statements for expoted items from the base file
/// 2. Wraps the content of the file in a `Deno.test` call
///
/// For example, given a file that looks like:
/// ```ts
/// import { assertEquals } from "@std/assert/equal";
///
/// assertEquals(increment(1), 2);
/// ```
///
/// and the base file (from which the above snippet was extracted):
///
/// ```ts
/// export function increment(n: number): number {
///  return n + 1;
/// }
///
/// export const SOME_CONST = "HELLO";
/// ```
///
/// The generated pseudo test file would look like:
///
/// ```ts
/// import { assertEquals } from "@std/assert/equal";
/// import { increment, SOME_CONST } from "./base.ts";
///
/// Deno.test("./base.ts$1-3.ts", async () => {
///  assertEquals(increment(1), 2);
/// });
/// ```
fn generate_pseudo_test_file(
  file: File,
  base_file_specifier: &ModuleSpecifier,
  exports: &ExportCollector,
) -> Result<File, AnyError> {
  let file = file.into_text_decoded()?;

  let parsed = deno_ast::parse_program(deno_ast::ParseParams {
    specifier: file.specifier.clone(),
    text: file.source,
    media_type: file.media_type,
    capture_tokens: false,
    scope_analysis: false,
    maybe_syntax: None,
  })?;

  let transformed =
    parsed
      .program_ref()
      .clone()
      .fold_with(&mut as_folder(Transform {
        specifier: &file.specifier,
        base_file_specifier,
        exports,
      }));

  Ok(File {
    specifier: file.specifier,
    maybe_headers: None,
    source: deno_ast::swc::codegen::to_code(&transformed)
      .into_bytes()
      .into(),
  })
}

struct Transform<'a> {
  specifier: &'a ModuleSpecifier,
  base_file_specifier: &'a ModuleSpecifier,
  exports: &'a ExportCollector,
}

impl<'a> VisitMut for Transform<'a> {
  fn visit_mut_program(&mut self, node: &mut ast::Program) {
    let new_module_items = match node {
      ast::Program::Module(module) => {
        let mut module_decls = vec![];
        let mut stmts = vec![];

        for item in &module.body {
          match item {
            ast::ModuleItem::ModuleDecl(decl) => {
              module_decls.push(decl.clone());
            }
            ast::ModuleItem::Stmt(stmt) => {
              stmts.push(stmt.clone());
            }
          }
        }

        let mut transformed_items = vec![];
        transformed_items
          .extend(module_decls.into_iter().map(ast::ModuleItem::ModuleDecl));
        let import_specifiers = self.exports.to_import_specifiers();
        if !import_specifiers.is_empty() {
          transformed_items.push(ast::ModuleItem::ModuleDecl(
            ast::ModuleDecl::Import(ast::ImportDecl {
              span: DUMMY_SP,
              specifiers: import_specifiers,
              src: Box::new(ast::Str {
                span: DUMMY_SP,
                value: self.base_file_specifier.to_string().into(),
                raw: None,
              }),
              type_only: false,
              with: None,
              phase: ast::ImportPhase::Evaluation,
            }),
          ));
        }
        transformed_items.push(ast::ModuleItem::Stmt(wrap_in_deno_test(
          stmts,
          self.specifier.to_string().into(),
        )));

        transformed_items
      }
      ast::Program::Script(script) => {
        let mut transformed_items = vec![];

        let import_specifiers = self.exports.to_import_specifiers();
        if !import_specifiers.is_empty() {
          transformed_items.push(ast::ModuleItem::ModuleDecl(
            ast::ModuleDecl::Import(ast::ImportDecl {
              span: DUMMY_SP,
              specifiers: self.exports.to_import_specifiers(),
              src: Box::new(ast::Str {
                span: DUMMY_SP,
                value: self.base_file_specifier.to_string().into(),
                raw: None,
              }),
              type_only: false,
              with: None,
              phase: ast::ImportPhase::Evaluation,
            }),
          ));
        }

        transformed_items.push(ast::ModuleItem::Stmt(wrap_in_deno_test(
          script.body.clone(),
          self.specifier.to_string().into(),
        )));

        transformed_items
      }
    };

    *node = ast::Program::Module(ast::Module {
      span: DUMMY_SP,
      body: new_module_items,
      shebang: None,
    });
  }
}

fn wrap_in_deno_test(stmts: Vec<ast::Stmt>, test_name: Atom) -> ast::Stmt {
  ast::Stmt::Expr(ast::ExprStmt {
    span: DUMMY_SP,
    expr: Box::new(ast::Expr::Call(ast::CallExpr {
      span: DUMMY_SP,
      callee: ast::Callee::Expr(Box::new(ast::Expr::Member(ast::MemberExpr {
        span: DUMMY_SP,
        obj: Box::new(ast::Expr::Ident(ast::Ident {
          span: DUMMY_SP,
          sym: "Deno".into(),
          optional: false,
          ..Default::default()
        })),
        prop: ast::MemberProp::Ident(ast::IdentName {
          span: DUMMY_SP,
          sym: "test".into(),
        }),
      }))),
      args: vec![
        ast::ExprOrSpread {
          spread: None,
          expr: Box::new(ast::Expr::Lit(ast::Lit::Str(ast::Str {
            span: DUMMY_SP,
            value: test_name,
            raw: None,
          }))),
        },
        ast::ExprOrSpread {
          spread: None,
          expr: Box::new(ast::Expr::Arrow(ast::ArrowExpr {
            span: DUMMY_SP,
            params: vec![],
            body: Box::new(ast::BlockStmtOrExpr::BlockStmt(ast::BlockStmt {
              span: DUMMY_SP,
              stmts,
              ..Default::default()
            })),
            is_async: true,
            is_generator: false,
            type_params: None,
            return_type: None,
            ..Default::default()
          })),
        },
      ],
      type_args: None,
      ..Default::default()
    })),
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::file_fetcher::TextDecodedFile;
  use deno_ast::swc::atoms::Atom;
  use pretty_assertions::assert_eq;

  #[test]
  fn test_extract_doc_tests() {
    struct Input {
      source: &'static str,
      specifier: &'static str,
    }
    struct Expected {
      source: &'static str,
      specifier: &'static str,
      media_type: MediaType,
    }
    struct Test {
      input: Input,
      expected: Vec<Expected>,
    }

    let tests = [
      Test {
        input: Input {
          source: r#""#,
          specifier: "file:///main.ts",
        },
        expected: vec![],
      },
      Test {
        input: Input {
          source: r#"
/**
 * ```ts
 * import { assertEquals } from "@std/assert/equal";
 * 
 * assertEquals(add(1, 2), 3);
 * ```
 */
export function add(a: number, b: number): number {
  return a + b;
}
"#,
          specifier: "file:///main.ts",
        },
        expected: vec![Expected {
          source: r#"import { assertEquals } from "@std/assert/equal";
import { add } from "file:///main.ts";
Deno.test("file:///main.ts$3-8.ts", async ()=>{
    assertEquals(add(1, 2), 3);
});
"#,
          specifier: "file:///main.ts$3-8.ts",
          media_type: MediaType::TypeScript,
        }],
      },
      Test {
        input: Input {
          source: r#"
/**
 * ```ts
 * foo();
 * ```
 */
export function foo() {}

export default class Bar {}
"#,
          specifier: "file:///main.ts",
        },
        expected: vec![Expected {
          source: r#"import Bar, { foo } from "file:///main.ts";
Deno.test("file:///main.ts$3-6.ts", async ()=>{
    foo();
});
"#,
          specifier: "file:///main.ts$3-6.ts",
          media_type: MediaType::TypeScript,
        }],
      },
      Test {
        input: Input {
          source: r#"
/**
 * ```ts
 * const input = { a: 42 } satisfies Args;
 * foo(input);
 * ```
 */
export function foo(args: Args) {}

export type Args = { a: number };
"#,
          specifier: "file:///main.ts",
        },
        expected: vec![Expected {
          source: r#"import { foo, Args } from "file:///main.ts";
Deno.test("file:///main.ts$3-7.ts", async ()=>{
    const input = {
        a: 42
    } satisfies Args;
    foo(input);
});
"#,
          specifier: "file:///main.ts$3-7.ts",
          media_type: MediaType::TypeScript,
        }],
      },
      Test {
        input: Input {
          source: r#"
/**
 * This is a module-level doc.
 *
 * ```ts
 * foo();
 * ```
 *
 * @module doc
 */
"#,
          specifier: "file:///main.ts",
        },
        expected: vec![Expected {
          source: r#"Deno.test("file:///main.ts$5-8.ts", async ()=>{
    foo();
});
"#,
          specifier: "file:///main.ts$5-8.ts",
          media_type: MediaType::TypeScript,
        }],
      },
      Test {
        input: Input {
          source: r#"
/**
 * This is a module-level doc.
 *
 * ```js
 * const cls = new MyClass();
 * ```
 *
 * @module doc
 */

/**
 * ```ts
 * foo();
 * ```
 */
export function foo() {}

export default class MyClass {}

export * from "./other.ts";
"#,
          specifier: "file:///main.ts",
        },
        expected: vec![
          Expected {
            source: r#"import MyClass, { foo } from "file:///main.ts";
Deno.test("file:///main.ts$5-8.js", async ()=>{
    const cls = new MyClass();
});
"#,
            specifier: "file:///main.ts$5-8.js",
            media_type: MediaType::JavaScript,
          },
          Expected {
            source: r#"import MyClass, { foo } from "file:///main.ts";
Deno.test("file:///main.ts$13-16.ts", async ()=>{
    foo();
});
"#,
            specifier: "file:///main.ts$13-16.ts",
            media_type: MediaType::TypeScript,
          },
        ],
      },
      Test {
        input: Input {
          source: r#"
# Header

This is a *markdown*.

```js
import { assertEquals } from "@std/assert/equal";
import { add } from "jsr:@deno/non-existent";

assertEquals(add(1, 2), 3);
```
"#,
          specifier: "file:///README.md",
        },
        expected: vec![Expected {
          source: r#"import { assertEquals } from "@std/assert/equal";
import { add } from "jsr:@deno/non-existent";
Deno.test("file:///README.md$6-12.js", async ()=>{
    assertEquals(add(1, 2), 3);
});
"#,
          specifier: "file:///README.md$6-12.js",
          media_type: MediaType::JavaScript,
        }],
      },
    ];

    for test in tests {
      let file = File {
        specifier: ModuleSpecifier::parse(test.input.specifier).unwrap(),
        maybe_headers: None,
        source: test.input.source.as_bytes().into(),
      };
      let got_decoded = extract_doc_tests(file)
        .unwrap()
        .into_iter()
        .map(|f| f.into_text_decoded().unwrap())
        .collect::<Vec<_>>();
      let expected = test
        .expected
        .iter()
        .map(|e| TextDecodedFile {
          specifier: ModuleSpecifier::parse(e.specifier).unwrap(),
          media_type: e.media_type,
          source: e.source.into(),
        })
        .collect::<Vec<_>>();
      assert_eq!(got_decoded, expected);
    }
  }

  #[test]
  fn test_export_collector() {
    fn helper(input: &'static str) -> ExportCollector {
      let mut collector = ExportCollector::default();
      let parsed = deno_ast::parse_module(deno_ast::ParseParams {
        specifier: deno_ast::ModuleSpecifier::parse("file:///main.ts").unwrap(),
        text: input.into(),
        media_type: deno_ast::MediaType::TypeScript,
        capture_tokens: false,
        scope_analysis: false,
        maybe_syntax: None,
      })
      .unwrap();

      collector.visit_program(parsed.program_ref());
      collector
    }

    struct Test {
      input: &'static str,
      named_expected: Vec<Atom>,
      default_expected: Option<Atom>,
    }

    let tests = [
      Test {
        input: r#"export const foo = 42;"#,
        named_expected: vec!["foo".into()],
        default_expected: None,
      },
      Test {
        input: r#"export let foo = 42;"#,
        named_expected: vec!["foo".into()],
        default_expected: None,
      },
      Test {
        input: r#"export var foo = 42;"#,
        named_expected: vec!["foo".into()],
        default_expected: None,
      },
      Test {
        input: r#"export const foo = () => {};"#,
        named_expected: vec!["foo".into()],
        default_expected: None,
      },
      Test {
        input: r#"export function foo() {}"#,
        named_expected: vec!["foo".into()],
        default_expected: None,
      },
      Test {
        input: r#"export class Foo {}"#,
        named_expected: vec!["Foo".into()],
        default_expected: None,
      },
      Test {
        input: r#"export enum Foo {}"#,
        named_expected: vec!["Foo".into()],
        default_expected: None,
      },
      Test {
        input: r#"export module Foo {}"#,
        named_expected: vec!["Foo".into()],
        default_expected: None,
      },
      Test {
        input: r#"export module "foo" {}"#,
        named_expected: vec!["foo".into()],
        default_expected: None,
      },
      Test {
        input: r#"export namespace Foo {}"#,
        named_expected: vec!["Foo".into()],
        default_expected: None,
      },
      Test {
        input: r#"export type Foo = string;"#,
        named_expected: vec!["Foo".into()],
        default_expected: None,
      },
      Test {
        input: r#"export interface Foo {};"#,
        named_expected: vec!["Foo".into()],
        default_expected: None,
      },
      Test {
        input: r#"export let name1, name2;"#,
        named_expected: vec!["name1".into(), "name2".into()],
        default_expected: None,
      },
      Test {
        input: r#"export const name1 = 1, name2 = 2;"#,
        named_expected: vec!["name1".into(), "name2".into()],
        default_expected: None,
      },
      Test {
        input: r#"export function* generatorFunc() {}"#,
        named_expected: vec!["generatorFunc".into()],
        default_expected: None,
      },
      Test {
        input: r#"export const { name1, name2: bar } = obj;"#,
        named_expected: vec!["name1".into(), "bar".into()],
        default_expected: None,
      },
      Test {
        input: r#"export const [name1, name2] = arr;"#,
        named_expected: vec!["name1".into(), "name2".into()],
        default_expected: None,
      },
      Test {
        input: r#"export const { name1 = 42 } = arr;"#,
        named_expected: vec!["name1".into()],
        default_expected: None,
      },
      Test {
        input: r#"export default function foo() {}"#,
        named_expected: vec![],
        default_expected: Some("foo".into()),
      },
      Test {
        input: r#"export { foo, bar as barAlias };"#,
        named_expected: vec!["foo".into(), "barAlias".into()],
        default_expected: None,
      },
      Test {
        input: r#"
export default class Foo {}

export let value1 = 42;

const value2 = "Hello";

const value3 = "World";

export { value2 };
"#,
        named_expected: vec!["value1".into(), "value2".into()],
        default_expected: Some("Foo".into()),
      },
      // The collector deliberately does not handle re-exports, because from
      // doc reader's perspective, an example code would become hard to follow
      // if it uses re-exported items (as opposed to normal, non-re-exported
      // items that would look verbose if an example code explicitly imports
      // them).
      Test {
        input: r#"
export * from "./module1.ts";
export * as name1 from "./module2.ts";
export { name2, name3 as N3 } from "./module3.js";
export { default } from "./module4.ts";
export { default as myDefault } from "./module5.ts";
"#,
        named_expected: vec![],
        default_expected: None,
      },
      Test {
        input: r#"
export namespace Foo {
  export type MyType = string;
  export const myValue = 42;
  export function myFunc(): boolean;
}
"#,
        named_expected: vec!["Foo".into()],
        default_expected: None,
      },
      Test {
        input: r#"
declare namespace Foo {
  export type MyType = string;
  export const myValue = 42;
  export function myFunc(): boolean;
}
"#,
        named_expected: vec![],
        default_expected: None,
      },
      Test {
        input: r#"
declare module Foo {
  export type MyType = string;
  export const myValue = 42;
  export function myFunc(): boolean;
}
"#,
        named_expected: vec![],
        default_expected: None,
      },
      Test {
        input: r#"
declare global {
  export type MyType = string;
  export const myValue = 42;
  export function myFunc(): boolean;
}
"#,
        named_expected: vec![],
        default_expected: None,
      },
    ];

    for test in tests {
      let got = helper(test.input);
      assert_eq!(got.named_exports, test.named_expected);
      assert_eq!(got.default_export, test.default_expected);
    }
  }
}