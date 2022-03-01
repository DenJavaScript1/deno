// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.

export {
  assert,
  assertEquals,
  assertRejects,
} from "../test_util/std/testing/asserts.ts";

const targetDir = Deno.execPath().replace(/[^\/\\]+$/, "");
const [libPrefix, libSuffix] = {
  darwin: ["lib", "dylib"],
  linux: ["lib", "so"],
  windows: ["", "dll"],
}[Deno.build.os];

export function loadTestLibrary() {
  const specifier = `${targetDir}/${libPrefix}test_napi.${libSuffix}`;
  return Deno.core.napiOpen(specifier);
}
