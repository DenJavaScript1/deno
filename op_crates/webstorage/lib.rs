// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.

use deno_core::error::bad_resource_id;
use deno_core::error::AnyError;
use deno_core::JsRuntime;
use deno_core::serde_json::json;
use deno_core::serde_json::Value;
use deno_core::OpState;
use deno_core::Resource;
use deno_core::ZeroCopyBuf;
use rusqlite::params;
use rusqlite::Connection;
use rusqlite::OptionalExtension;
use serde::Deserialize;
use std::borrow::Cow;
use std::path::PathBuf;

#[derive(Clone)]
pub struct LocationDataDir(pub Option<PathBuf>);

/// Load and execute the javascript code.
pub fn init(isolate: &mut JsRuntime) {
  isolate
    .execute(
      "deno:op_crates/webstorage/01_webstorage.js",
      include_str!("01_webstorage.js"),
    )
    .unwrap();
}


struct WebStorageConnectionResource(Connection);

impl Resource for WebStorageConnectionResource {
  fn name(&self) -> Cow<str> {
    "webStorage".into()
  }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenArgs {
  persistent: bool,
}

pub fn op_webstorage_open(
  state: &mut OpState,
  args: OpenArgs,
  _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
  if args.persistent {
    let path = &state.borrow::<LocationDataDir>().0.clone().unwrap();
    std::fs::create_dir_all(&path).unwrap();

    let connection = Connection::open(path.join("local_storage")).unwrap();

    connection
      .execute(
        "CREATE TABLE IF NOT EXISTS data (key VARCHAR UNIQUE, value VARCHAR)",
        params![],
      )
      .unwrap();

    let rid = state
      .resource_table
      .add(WebStorageConnectionResource(connection));
    Ok(json!({ "rid": rid }))
  } else {
    let connection = Connection::open_in_memory().unwrap();
    connection
      .execute(
        "CREATE TABLE data (key VARCHAR UNIQUE, value VARCHAR)",
        params![],
      )
      .unwrap();
    let rid = state
      .resource_table
      .add(WebStorageConnectionResource(connection));
    Ok(json!({ "rid": rid }))
  }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LengthArgs {
  rid: u32,
}

pub fn op_webstorage_length(
  state: &mut OpState,
  args: LengthArgs,
  _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
  let resource = state
    .resource_table
    .get::<WebStorageConnectionResource>(args.rid)
    .ok_or_else(bad_resource_id)?;

  let mut stmt = resource.0
    .prepare("SELECT COUNT(*) FROM data")
    .unwrap();

  let length: u32 = stmt.query_row(params![], |row| row.get(0)).unwrap();

  Ok(json!(length))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyArgs {
  rid: u32,
  index: u32,
}

pub fn op_webstorage_key(
  state: &mut OpState,
  args: KeyArgs,
  _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
  let resource = state
    .resource_table
    .get::<WebStorageConnectionResource>(args.rid)
    .ok_or_else(bad_resource_id)?;

  let mut stmt = resource.0
    .prepare("SELECT key FROM data LIMIT 1 OFFSET ?")
    .unwrap();

  let key: Option<String> = stmt
    .query_row(params![args.index], |row| row.get(0))
    .optional()
    .unwrap();

  let json_val = match key {
    Some(string) => json!(string),
    None => Value::Null,
  };

  Ok(json_val)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetArgs {
  rid: u32,
  key_name: String,
  key_value: String,
}

pub fn op_webstorage_set(
  state: &mut OpState,
  args: SetArgs,
  _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
  let resource = state
    .resource_table
    .get::<WebStorageConnectionResource>(args.rid)
    .ok_or_else(bad_resource_id)?;

  resource.0
    .execute(
      "INSERT OR REPLACE INTO data (key, value) VALUES (?, ?)",
      params![args.key_name, args.key_value],
    )
    .unwrap();

  Ok(json!({}))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetArgs {
  rid: u32,
  key_name: String,
}

pub fn op_webstorage_get(
  state: &mut OpState,
  args: GetArgs,
  _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
  let resource = state
    .resource_table
    .get::<WebStorageConnectionResource>(args.rid)
    .ok_or_else(bad_resource_id)?;

  let mut stmt = resource.0
    .prepare("SELECT value FROM data WHERE key = ?")
    .unwrap();

  let val: Option<String> = stmt
    .query_row(params![args.key_name], |row| row.get(0))
    .optional()
    .unwrap();

  Ok(json!(val))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveArgs {
  rid: u32,
  key_name: String,
}

pub fn op_webstorage_remove(
  state: &mut OpState,
  args: RemoveArgs,
  _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
  let resource = state
    .resource_table
    .get::<WebStorageConnectionResource>(args.rid)
    .ok_or_else(bad_resource_id)?;

  resource.0
    .execute("DELETE FROM data WHERE key = ?", params![args.key_name])
    .unwrap();

  Ok(json!({}))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearArgs {
  rid: u32,
}

pub fn op_webstorage_clear(
  state: &mut OpState,
  args: ClearArgs,
  _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
  let resource = state
    .resource_table
    .get::<WebStorageConnectionResource>(args.rid)
    .ok_or_else(bad_resource_id)?;

  resource.0
    .execute("DROP TABLE data", params![])
    .unwrap();
  resource.0
    .execute(
      "CREATE TABLE data (key VARCHAR UNIQUE, value VARCHAR)",
      params![],
    )
    .unwrap();

  Ok(json!({}))
}
