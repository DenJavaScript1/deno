use std::cell::RefCell;
use std::rc::Rc;

use crate::error::AnyError;
use crate::{OpFn, OpId, OpState};

pub type SourcePair = (&'static str, &'static str);
pub type OpPair = (&'static str, Box<OpFn>);
pub type RcOpRegistrar = Rc<RefCell<dyn OpRegistrar>>;
pub type OpMiddlewareFn = dyn Fn(&'static str, Box<OpFn>) -> Box<OpFn>;
pub type OpStateFn = dyn Fn(&mut OpState) -> Result<(), AnyError>;

#[derive(Default)]
pub struct Extension {
  js_files: Option<Vec<SourcePair>>,
  ops: Option<Vec<OpPair>>,
  opstate_fn: Option<Box<OpStateFn>>,
  middleware_fn: Option<Box<OpMiddlewareFn>>,
}

impl Extension {
  pub fn new(
    js_files: Option<Vec<SourcePair>>,
    ops: Option<Vec<OpPair>>,
    opstate_fn: Option<Box<OpStateFn>>,
    middleware_fn: Option<Box<OpMiddlewareFn>>,
  ) -> Self {
    Self {
      js_files,
      ops,
      opstate_fn,
      middleware_fn,
    }
  }

  pub fn pure_js(js_files: Vec<SourcePair>) -> Self {
    Self::new(Some(js_files), None, None, None)
  }

  pub fn with_ops(
    js_files: Vec<SourcePair>,
    ops: Vec<OpPair>,
    opstate_fn: Option<Box<OpStateFn>>,
  ) -> Self {
    Self::new(Some(js_files), Some(ops), opstate_fn, None)
  }
}

// Note: this used to be a trait, but we "downgraded" it to a single concrete type
// for the initial iteration, it will like become a trait in the future
impl Extension {
  /// returns JS source code to be loaded into the isolate (either at snapshotting,
  /// or at startup).  as a vector of a tuple of the file name, and the source code.
  pub fn init_js(&self) -> Result<Vec<SourcePair>, AnyError> {
    Ok(match &self.js_files {
      Some(files) => files.clone(),
      None => vec![],
    })
  }

  /// Called at JsRuntime startup to initialize ops in the isolate.
  pub fn init_ops(&mut self, registrar: RcOpRegistrar) -> Result<(), AnyError> {
    // NOTE: not idempotent
    // TODO: fail if called twice ?
    if let Some(ops) = self.ops.take() {
      for (name, opfn) in ops {
        registrar.borrow_mut().register_op(name, opfn);
      }
    }
    Ok(())
  }

  // Allows setting up the initial op-state of an isolate at startup.
  pub fn init_state(&self, state: &mut OpState) -> Result<(), AnyError> {
    match &self.opstate_fn {
      Some(ofn) => ofn(state),
      None => Ok(()),
    }
  }

  /// init_registrar lets us middleware op registrations, it's called before init_ops
  pub fn init_registrar(&mut self, registrar: RcOpRegistrar) -> RcOpRegistrar {
    match self.middleware_fn.take() {
      Some(middleware_fn) => Rc::new(RefCell::new(OpMiddleware {
        registrar,
        middleware_fn,
      })),
      None => registrar,
    }
  }
}

// The OpRegistrar trait allows building op "middleware" such as:
// OpMetrics, OpTracing or OpDisabler that wrap OpFns for profiling, debugging, etc...
// JsRuntime is itself an OpRegistrar
pub trait OpRegistrar {
  fn register_op(&mut self, name: &'static str, op_fn: Box<OpFn>) -> OpId;
  // register_minimal_op_sync(...)
  // register_minimal_op_async(...)
  // register_json_op_sync(...)
  // register_json_op_async(...)
}

// OpMiddleware wraps an original OpRegistrar with an OpMiddlewareFn
pub struct OpMiddleware {
  registrar: RcOpRegistrar,
  middleware_fn: Box<OpMiddlewareFn>,
}

impl OpRegistrar for OpMiddleware {
  fn register_op(&mut self, name: &'static str, op_fn: Box<OpFn>) -> OpId {
    let new_op = (self.middleware_fn)(name, op_fn);
    self.registrar.borrow_mut().register_op(name, new_op)
  }
}

////
// Helper macros to reduce verbosity / redundant decls
////

// include_js_files! helps embed JS files in an extension
// Example:
// ```
// include_js_files!(
//   prefix "deno:op_crates/hello",
//   "01_hello.js",
//   "02_goodbye.js",
// )
// ```
#[macro_export]
macro_rules! include_js_files {
  (prefix $prefix:literal, $($file:literal,)+) => {
    vec![
      $((
        concat!($prefix, "/", $file),
        include_str!($file),
      ),)+
    ]
  };
}

// declare_ops! helps declare ops for an extension.
// Example:
// ```
//  declare_ops(json_op_sync[
//    op_foo,
//    op_bar,
//  ]),
// ```
// TODO: improve robustness by handling different func patterns in a single block
#[macro_export]
macro_rules! declare_ops {
  // Match plain function identifiers, e.g: op_foo
  ($wrapper:path[$($opfn:ident,)+]) => {
    vec![$((
      stringify!($opfn),
      $wrapper($opfn),
    ),)+]
  };

  // Match prefixed function identifiers, e.g: mod_a::op_foo
  ($wrapper:path[$($path:ident::$opfn:ident,)+]) => {
    vec![$((
      stringify!($opfn),
      $wrapper($path::$opfn),
    ),)+]
  };

  // TODO: support matching funcs with type-parameters (e.g: permissions)
}

// Groups a sequence of declare_ops!() calls into a single vec.
// Example:
// ```
// declare_ops_group(vec![
//  declare_ops(json_op_sync[
//    ...,
//  ]),
//  declare_ops(json_op_async[
//    ...,
//  ]),
// ])
// ```
pub fn declare_ops_group(
  groups: Vec<Vec<(&'static str, Box<OpFn>)>>,
) -> Vec<(&'static str, Box<OpFn>)> {
  groups
    .into_iter()
    .fold(vec![].into_iter(), |v, g| {
      v.chain(g.into_iter())
        .collect::<Vec<(&'static str, Box<OpFn>)>>()
        .into_iter()
    })
    .collect()
}
