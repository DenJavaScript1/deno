// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
"use strict";

((window) => {
  const core = window.Deno.core;

  function getRandomValues(arrayBufferView) {
    if (!ArrayBuffer.isView(arrayBufferView)) {
      throw new TypeError(
        "Argument 1 does not implement interface ArrayBufferView",
      );
    }
    if (
      !(
        arrayBufferView instanceof Int8Array ||
        arrayBufferView instanceof Uint8Array ||
        arrayBufferView instanceof Int16Array ||
        arrayBufferView instanceof Uint16Array ||
        arrayBufferView instanceof Int32Array ||
        arrayBufferView instanceof Uint32Array ||
        arrayBufferView instanceof Uint8ClampedArray
      )
    ) {
      throw new DOMException(
        "The provided ArrayBufferView is not an integer array type",
        "TypeMismatchError",
      );
    }
    if (arrayBufferView.byteLength > 65536) {
      throw new DOMException(
        `The ArrayBufferView's byte length (${arrayBufferView.byteLength}) exceeds the number of bytes of entropy available via this API (65536)`,
        "QuotaExceededError",
      );
    }
    const ui8 = new Uint8Array(
      arrayBufferView.buffer,
      arrayBufferView.byteOffset,
      arrayBufferView.byteLength,
    );
    core.jsonOpSync("op_crypto_get_random_values", {}, ui8);
    return arrayBufferView;
  }

  // Represents a rid in a CryptoKey instance.
  const ridSymbol = Symbol();

  // The CryptoKey class. A JavaScript representation of a WebCrypto key.
  // Stores rid of the actual key along with read-only properties.
  class CryptoKey {
    #usages
    #extractable
    #algorithm
    #keyType

    constructor(key, rid) {
      this.#usages = key.usages;
      this.#extractable = key.extractable;
      this.#algorithm = key.algorithm;
      this.#keyType = key.keyType;
      this[ridSymbol] = rid;
    }

    get usages() {
      return this.#usages;
    }

    get extractable() {
      return this.#extractable;
    }

    get algorithm() {
      return this.#algorithm;
    }

    get keyType() {
      return this.#keyType;
    }
  }

  class CryptoKeyPair {
    constructor(privateKey, publicKey, rid) {
      this.privateKey = new CryptoKey(privateKey);
      this.publicKey = new CryptoKey(publicKey);
      this[ridSymbol] = rid;
    }
  }

  async function generateKey(algorithm, extractable, keyUsages) {
    let { rid, key } = await core.jsonOpAsync("op_webcrypto_generate_key", { algorithm, extractable, keyUsages });
    return key.single ? new CryptoKey(key.single, rid) : new CryptoKeyPair(key.pair.privateKey, key.pair.publicKey, rid);
  }

  async function sign(algorithm, key, data) {
    let rid = key[ridSymbol];
    let simpleParam = typeof algorithm == "string";

    // Normalize params. We've got serde doing the null to Option serialization.
    let saltLength = simpleParam ? null: algorithm.saltLength || null;
    let hash = simpleParam ? null : algorithm.hash || null;
    algorithm = simpleParam ? algorithm : algorithm.name;
    
    console.log(rid)
    return await core.jsonOpAsync("op_webcrypto_sign_key", { rid, algorithm, saltLength, hash }, data).data;
  }

  const subtle = {
    generateKey,
    sign,
  };

  window.crypto = {
    getRandomValues,
    subtle,
  };
  window.__bootstrap = window.__bootstrap || {};
  window.__bootstrap.crypto = {
    getRandomValues,
    generateKey,
    subtle,
  };
})(this);
