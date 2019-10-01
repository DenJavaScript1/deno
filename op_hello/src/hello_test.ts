// We need some way to import test modules.
// Attempt one:
//
//   import { test } from "../../js/test_util.ts";
//
// Here it is referencing files across crate boundaries, which will break
// 'cargo package' and means the crate is not useable outside the deno tree.
// This might be okay for a first pass, but it's not the best solution.
//
// Attempt two:
// we invent a new URL for referencing files in other crates.
// this is magic and not browser compatible.. Browser compatibility for
// ops is not so important.
//
//  import { test } from "crate://deno_std@0.19.0/testing/mod.ts";
//
// This is quite nice. But the version of deno_std already specified in
// Cargo.toml. I think we shouldn't repeat it.
import { test } from "crate://deno_std/testing/mod.ts";

// If we don't do the //src reorg that I've proposed in #3022, then we might be
// able to have a very elegant URL some day using the deno crate.
//
//  import { test } from "crate://deno/std/testing/mod.ts";

import "./hello.ts";

test("hello test", () => {
  Deno.hello();
});

test("hello test2", () => {
  Deno.hello();
});
