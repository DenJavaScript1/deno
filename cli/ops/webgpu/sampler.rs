// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.

use deno_core::error::type_error;
use deno_core::error::AnyError;
use deno_core::error::{bad_resource_id, not_supported};
use deno_core::serde_json::json;
use deno_core::serde_json::Value;
use deno_core::BufVec;
use deno_core::OpState;
use deno_core::{serde_json, ZeroCopyBuf};
use serde::Deserialize;
use std::borrow::Cow;
use std::cell::RefCell;
use std::rc::Rc;

fn serialize_address_mode(address_mode: Option<String>) -> wgt::AddressMode {
  match address_mode {
    Some(&"clamp-to-edge") => wgt::AddressMode::ClampToEdge,
    Some(&"repeat") => wgt::AddressMode::Repeat,
    Some(&"mirror-repeat") => wgt::AddressMode::MirrorRepeat,
    Some(_) => unreachable!(),
    None => wgt::AddressMode::ClampToEdge,
  }
}

fn serialize_filter_mode(filter_mode: Option<String>) -> wgt::FilterMode {
  match filter_mode {
    Some(&"nearest") => wgt::FilterMode::Nearest,
    Some(&"linear") => wgt::FilterMode::Linear,
    Some(_) => unreachable!(),
    None => wgt::FilterMode::Nearest,
  }
}

pub fn serialize_compare_function(compare: String) -> wgt::CompareFunction {
  match compare {
    &"never" => wgt::CompareFunction::Never,
    &"less" => wgt::CompareFunction::Less,
    &"equal" => wgt::CompareFunction::Equal,
    &"less-equal" => wgt::CompareFunction::LessEqual,
    &"greater" => wgt::CompareFunction::Greater,
    &"not-equal" => wgt::CompareFunction::NotEqual,
    &"greater-equal" => wgt::CompareFunction::GreaterEqual,
    &"always" => wgt::CompareFunction::Always,
    _ => unreachable!(),
  }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSamplerArgs {
  instance_rid: u32,
  device_rid: u32,
  label: Option<String>,
  address_mode_u: Option<String>,
  address_mode_v: Option<String>,
  address_mode_w: Option<String>,
  mag_filter: Option<String>,
  min_filter: Option<String>,
  mipmap_filter: Option<String>,
  lod_min_clamp: Option<f32>,
  lod_max_clamp: Option<f32>,
  compare: Option<String>,
  max_anisotropy: Option<std::num::NonZeroU8>,
}

pub fn op_webgpu_create_sampler(
  state: &mut OpState,
  args: Value,
  _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
  let args: CreateSamplerArgs = serde_json::from_value(args)?;

  let instance = state
    .resource_table
    .get_mut::<super::WgcInstance>(args.instance_rid)
    .ok_or_else(bad_resource_id)?;
  let device = state
    .resource_table
    .get_mut::<wgc::id::DeviceId>(args.device_rid)
    .ok_or_else(bad_resource_id)?;

  let sampler = instance.device_create_sampler(
    *device,
    &wgc::resource::SamplerDescriptor {
      label: args.label.map(|label| Cow::Borrowed(&label)),
      address_modes: [
        serialize_address_mode(args.address_mode_u),
        serialize_address_mode(args.address_mode_v),
        serialize_address_mode(args.address_mode_w),
      ],
      mag_filter: serialize_filter_mode(args.mag_filter),
      min_filter: serialize_filter_mode(args.min_filter),
      mipmap_filter: serialize_filter_mode(args.mipmap_filter),
      lod_min_clamp: args.lod_min_clamp.unwrap_or(0.0),
      lod_max_clamp: args.lod_max_clamp.unwrap_or(0xffffffff as f32), // TODO: check if there is a better solution
      compare: args.compare.map(serialize_compare_function),
      anisotropy_clamp: Some(
        args
          .max_anisotropy
          .unwrap_or(unsafe { std::num::NonZeroU8::new_unchecked(1) }),
      ), // TODO: check what None would be
    },
    (), // TODO: id_in
  )?;

  let rid = state.resource_table.add("webGPUTexture", Box::new(sampler));

  Ok(json!({
    "rid": rid,
  }))
}
