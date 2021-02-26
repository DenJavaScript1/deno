// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.

//#![deny(warnings)]

use deno_core::error::AnyError;
use deno_core::serde_json;
use deno_core::serde_json::json;
use deno_core::serde_json::Value;
use deno_core::BufVec;
use deno_core::JsRuntime;
use deno_core::OpState;
use deno_core::Resource;
use deno_core::ZeroCopyBuf;
use serde::Deserialize;
use serde::Serialize;

use std::borrow::Cow;
use std::cell::RefCell;
use std::rc::Rc;

use rsa::algorithms::generate_multi_prime_key;
use rsa::RSAPrivateKey;
use rsa::RSAPublicKey;

use rand::rngs::StdRng;
use rand::thread_rng;
use rand::Rng;
use rand::rngs::OsRng;

pub use rand; // Re-export rand

mod key;

use crate::key::Algorithm;
use crate::key::CryptoKeyPair;
use crate::key::KeyType;
use crate::key::KeyUsage;
use crate::key::WebCryptoKey;
use crate::key::WebCryptoKeyPair;

/// Execute this crates' JS source files.
pub fn init(isolate: &mut JsRuntime) {
  let files = vec![(
    "deno:op_crates/crypto/01_crypto.js",
    include_str!("01_crypto.js"),
  )];
  for (url, source_code) in files {
    isolate.execute(url, source_code).unwrap();
  }
}

pub fn op_crypto_get_random_values(
  state: &mut OpState,
  _args: Value,
  zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
  assert_eq!(zero_copy.len(), 1);
  let maybe_seeded_rng = state.try_borrow_mut::<StdRng>();
  if let Some(seeded_rng) = maybe_seeded_rng {
    seeded_rng.fill(&mut *zero_copy[0]);
  } else {
    let mut rng = thread_rng();
    rng.fill(&mut *zero_copy[0]);
  }

  Ok(json!({}))
}

struct CryptoKeyPairResource<A, B> {
  crypto_key: WebCryptoKeyPair,
  key: CryptoKeyPair<A, B>,
}

impl Resource for CryptoKeyPairResource<RSAPublicKey, RSAPrivateKey> {
  fn name(&self) -> Cow<str> {
    "usbDeviceHandle".into()
  }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebCryptoAlgorithmArg {
  name: Algorithm,
  public_modulus: u32,
  modulus_length: u32,
  // hash: Option<WebCryptoHash>,
  // named_curve: Option<WebCryptoNamedCurve>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebCryptoGenerateKeyArg {
  algorithm: WebCryptoAlgorithmArg,
  extractable: bool,
  key_usages: Vec<KeyUsage>,
}

pub fn op_webcrypto_generate_key(
  state: &mut OpState,
  args: Value,
  _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
  let args: WebCryptoGenerateKeyArg = serde_json::from_value(args)?;
  let exponent = args.algorithm.public_modulus;
  let bits = args.algorithm.modulus_length;
  let extractable = args.extractable;
  let algorithm = args.algorithm.name;

  let (public_key, private_key) = match algorithm {
    Algorithm::RsassaPkcs1v15 | Algorithm::RsaPss | Algorithm::RsaOaep => {
      let mut rng = OsRng;
      let private_key = generate_multi_prime_key(&mut rng, exponent as usize, bits as usize)?;
      (
        private_key.to_public_key(),
        private_key,
      )
    }
    _ => return Ok(json!({})),
  };

  let webcrypto_key_public = WebCryptoKey {
    key_type: KeyType::Public,
    algorithm: algorithm.clone(),
    extractable,
    usages: vec![],
  };
  let webcrypto_key_private = WebCryptoKey {
    key_type: KeyType::Private,
    algorithm,
    extractable,
    usages: vec![],
  };
  let crypto_key =
    WebCryptoKeyPair::new(webcrypto_key_public, webcrypto_key_private);
  let key = CryptoKeyPair {
    public_key,
    private_key,
  };
  let resource = CryptoKeyPairResource { crypto_key, key };
  let rid = state.resource_table.add(resource);
  Ok(json!({ "rid": rid }))
}
