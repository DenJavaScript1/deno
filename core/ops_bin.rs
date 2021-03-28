// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.

use crate::error::type_error;
use crate::error::AnyError;
use crate::futures::future::FutureExt;
use crate::serialize_op_result;
use crate::BufVec;
use crate::Op;
use crate::OpBuf;
use crate::OpFn;
use crate::OpPayload;
use crate::OpResponse;
use crate::OpState;
use crate::PromiseId;
use crate::RcOpState;
use crate::ZeroCopyBuf;
use std::boxed::Box;
use std::future::Future;

// TODO: rewrite this, to have consistent buffer returns
// possibly via direct serde_v8 support
pub trait ValueOrVector {
  fn value(&self) -> u32;
  fn vector(self) -> Option<Vec<u8>>;
}

impl ValueOrVector for Vec<u8> {
  fn value(&self) -> u32 {
    self.len() as u32
  }
  fn vector(self) -> Option<Vec<u8>> {
    Some(self)
  }
}

impl ValueOrVector for u32 {
  fn value(&self) -> u32 {
    *self
  }
  fn vector(self) -> Option<Vec<u8>> {
    None
  }
}

/// Creates an op that passes data synchronously using raw ui8 buffer.
///
/// The provided function `op_fn` has the following parameters:
/// * `&mut OpState`: the op state, can be used to read/write resources in the runtime from an op.
/// * `argument`: the i32 value that is passed to the Rust function.
/// * `&mut [ZeroCopyBuf]`: raw bytes passed along.
///
/// `op_fn` returns an array buffer value, which is directly returned to JavaScript.
///
/// When registering an op like this...
/// ```ignore
/// let mut runtime = JsRuntime::new(...);
/// runtime.register_op("hello", deno_core::bin_op_sync(Self::hello_op));
/// ```
///
/// ...it can be invoked from JS using the provided name, for example:
/// ```js
/// Deno.core.ops();
/// let result = Deno.core.binOpSync("function_name", args);
/// ```
///
/// The `Deno.core.ops()` statement is needed once before any op calls, for initialization.
/// A more complete example is available in the examples directory.
pub fn bin_op_sync<F, R>(op_fn: F) -> Box<OpFn>
where
  F: Fn(&mut OpState, u32, &mut [ZeroCopyBuf]) -> Result<R, AnyError> + 'static,
  R: ValueOrVector,
{
  Box::new(move |state, _, payload, buf| -> Op {
    let min_arg: u32 = payload.deserialize().unwrap();
    // For sig compat map OpBuf to BufVec
    let mut bufs: BufVec = match buf {
      Some(b) => vec![b],
      None => vec![],
    }
    .into();
    // Bin op buffer arg assert
    if bufs.len() == 0 {
      return Op::Sync(serialize_bin_result::<u32>(
        None,
        Err(type_error("bin-ops require a non-null buffer arg")),
        state,
      ));
    }

    let result = op_fn(&mut state.borrow_mut(), min_arg, &mut bufs);
    Op::Sync(serialize_bin_result(None, result, state))
  })
}

// wraps serialize_op_result but handles ValueOrVector
fn serialize_bin_result<R>(
  pid: Option<PromiseId>,
  result: Result<R, AnyError>,
  state: RcOpState,
) -> OpResponse
where
  R: ValueOrVector,
{
  match result {
    Ok(v) => {
      let min_val = v.value();
      match v.vector() {
        // Warning! this is incorrect, but buffers aren't use ATM, will fix in future PR
        Some(vec) => OpResponse::Buffer(vec.into()),
        // u32
        None => serialize_op_result(pid, Ok(min_val), state),
      }
    }
    Err(e) => serialize_op_result::<()>(pid, Err(e), state),
  }
}

/// Creates an op that passes data asynchronously using raw ui8 buffer.
///
/// The provided function `op_fn` has the following parameters:
/// * `Rc<RefCell<OpState>>`: the op state, can be used to read/write resources in the runtime from an op.
/// * `argument`: the i32 value that is passed to the Rust function.
/// * `BufVec`: raw bytes passed along, usually not needed if the JSON value is used.
///
/// `op_fn` returns a future, whose output is a JSON value. This value will be asynchronously
/// returned to JavaScript.
///
/// When registering an op like this...
/// ```ignore
/// let mut runtime = JsRuntime::new(...);
/// runtime.register_op("hello", deno_core::json_op_async(Self::hello_op));
/// ```
///
/// ...it can be invoked from JS using the provided name, for example:
/// ```js
/// Deno.core.ops();
/// let future = Deno.core.jsonOpAsync("function_name", args);
/// ```
///
/// The `Deno.core.ops()` statement is needed once before any op calls, for initialization.
/// A more complete example is available in the examples directory.
pub fn bin_op_async<F, R, RV>(op_fn: F) -> Box<OpFn>
where
  F: Fn(RcOpState, u32, BufVec) -> R + 'static,
  R: Future<Output = Result<RV, AnyError>> + 'static,
  RV: ValueOrVector,
{
  Box::new(
    move |state: RcOpState, pid: PromiseId, p: OpPayload, b: OpBuf| -> Op {
      let min_arg: u32 = p.deserialize().unwrap();
      // For sig compat map OpBuf to BufVec
      let bufs: BufVec = match b {
        Some(b) => vec![b],
        None => vec![],
      }
      .into();
      // Bin op buffer arg assert
      if bufs.len() == 0 {
        return Op::Sync(serialize_bin_result::<u32>(
          None,
          Err(type_error("bin-ops require a non-null buffer arg")),
          state,
        ));
      }

      let fut = op_fn(state.clone(), min_arg, bufs)
        .map(move |result| serialize_bin_result(Some(pid), result, state));
      let temp = Box::pin(fut);
      Op::Async(temp)
    },
  )
}
