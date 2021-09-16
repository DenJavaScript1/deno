import {
  assert,
  assertEquals,
  assertThrowsAsync,
  unitTest,
} from "./test_util.ts";

// https://github.com/denoland/deno/issues/11664
unitTest(async function testImportArrayBufferKey() {
  const subtle = window.crypto.subtle;
  assert(subtle);

  // deno-fmt-ignore
  const key = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

  const cryptoKey = await subtle.importKey(
    "raw",
    key.buffer,
    { name: "HMAC", hash: "SHA-1" },
    true,
    ["sign"],
  );
  assert(cryptoKey);

  // Test key usage
  await subtle.sign({ name: "HMAC" }, cryptoKey, new Uint8Array(8));
});

// TODO(@littledivy): Remove this when we enable WPT for sign_verify
unitTest(async function testSignVerify() {
  const subtle = window.crypto.subtle;
  assert(subtle);
  for (const algorithm of ["RSA-PSS", "RSASSA-PKCS1-v1_5"]) {
    for (
      const hash of [
        "SHA-1",
        "SHA-256",
        "SHA-384",
        "SHA-512",
      ]
    ) {
      const keyPair = await subtle.generateKey(
        {
          name: algorithm,
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash,
        },
        true,
        ["sign", "verify"],
      );

      const data = new Uint8Array([1, 2, 3]);

      const signAlgorithm = { name: algorithm, saltLength: 32 };

      const signature = await subtle.sign(
        signAlgorithm,
        keyPair.privateKey,
        data,
      );

      assert(signature);
      assert(signature.byteLength > 0);
      assert(signature.byteLength % 8 == 0);
      assert(signature instanceof ArrayBuffer);

      const verified = await subtle.verify(
        signAlgorithm,
        keyPair.publicKey,
        signature,
        data,
      );
      assert(verified);
    }
  }
});

// deno-fmt-ignore
const plainText = new Uint8Array([95, 77, 186, 79, 50, 12, 12, 232, 118, 114, 90, 252, 229, 251, 210, 91, 248, 62, 90, 113, 37, 160, 140, 175, 231, 60, 62, 186, 196, 33, 119, 157, 249, 213, 93, 24, 12, 58, 233, 148, 38, 69, 225, 216, 47, 238, 140, 157, 41, 75, 60, 177, 160, 138, 153, 49, 32, 27, 60, 14, 129, 252, 71, 202, 207, 131, 21, 162, 175, 102, 50, 65, 19, 195, 182, 98, 48, 195, 70, 8, 196, 244, 89, 54, 52, 206, 2, 178, 103, 54, 34, 119, 240, 168, 64, 202, 116, 188, 61, 26, 98, 54, 149, 44, 94, 215, 170, 248, 168, 254, 203, 221, 250, 117, 132, 230, 151, 140, 234, 93, 42, 91, 159, 183, 241, 180, 140, 139, 11, 229, 138, 48, 82, 2, 117, 77, 131, 118, 16, 115, 116, 121, 60, 240, 38, 170, 238, 83, 0, 114, 125, 131, 108, 215, 30, 113, 179, 69, 221, 178, 228, 68, 70, 255, 197, 185, 1, 99, 84, 19, 137, 13, 145, 14, 163, 128, 152, 74, 144, 25, 16, 49, 50, 63, 22, 219, 204, 157, 107, 225, 104, 184, 72, 133, 56, 76, 160, 62, 18, 96, 10, 193, 194, 72, 2, 138, 243, 114, 108, 201, 52, 99, 136, 46, 168, 192, 42, 171]);

// Passing
const hashPlainTextVector = [
  {
    hash: "SHA-1",
    plainText: plainText.slice(0, 214),
  },
  {
    hash: "SHA-256",
    plainText: plainText.slice(0, 190),
  },
  {
    hash: "SHA-384",
    plainText: plainText.slice(0, 158),
  },
  {
    hash: "SHA-512",
    plainText: plainText.slice(0, 126),
  },
];

// TODO(@littledivy): Remove this when we enable WPT for encrypt_decrypt
unitTest(async function testEncryptDecrypt() {
  const subtle = window.crypto.subtle;
  assert(subtle);
  for (
    const { hash, plainText } of hashPlainTextVector
  ) {
    const keyPair = await subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash,
      },
      true,
      ["encrypt", "decrypt"],
    );

    const encryptAlgorithm = { name: "RSA-OAEP" };
    const cipherText = await subtle.encrypt(
      encryptAlgorithm,
      keyPair.publicKey,
      plainText,
    );

    assert(cipherText);
    assert(cipherText.byteLength > 0);
    assertEquals(cipherText.byteLength * 8, 2048);
    assert(cipherText instanceof ArrayBuffer);

    const decrypted = await subtle.decrypt(
      encryptAlgorithm,
      keyPair.privateKey,
      cipherText,
    );
    assert(decrypted);
    assert(decrypted instanceof ArrayBuffer);
    assertEquals(new Uint8Array(decrypted), plainText);

    const badPlainText = new Uint8Array(plainText.byteLength + 1);
    badPlainText.set(plainText, 0);
    badPlainText.set(new Uint8Array([32]), plainText.byteLength);
    await assertThrowsAsync(async () => {
      // Should fail
      await subtle.encrypt(
        encryptAlgorithm,
        keyPair.publicKey,
        badPlainText,
      );
      throw new TypeError("unreachable");
    }, DOMException);
  }
});

unitTest(async function testGenerateRSAKey() {
  const subtle = window.crypto.subtle;
  assert(subtle);

  const keyPair = await subtle.generateKey(
    {
      name: "RSA-PSS",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  assert(keyPair.privateKey);
  assert(keyPair.publicKey);
  assertEquals(keyPair.privateKey.extractable, true);
  assert(keyPair.privateKey.usages.includes("sign"));
});

unitTest(async function testGenerateHMACKey() {
  const key = await window.crypto.subtle.generateKey(
    {
      name: "HMAC",
      hash: "SHA-512",
    },
    true,
    ["sign", "verify"],
  );

  assert(key);
  assertEquals(key.extractable, true);
  assert(key.usages.includes("sign"));
});

unitTest(async function testECDSASignVerify() {
  const key = await window.crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-384",
    },
    true,
    ["sign", "verify"],
  );

  const encoder = new TextEncoder();
  const encoded = encoder.encode("Hello, World!");
  const signature = await window.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-384" },
    key.privateKey,
    encoded,
  );

  assert(signature);
  assert(signature instanceof ArrayBuffer);

  const verified = await window.crypto.subtle.verify(
    { hash: { name: "SHA-384" }, name: "ECDSA" },
    key.publicKey,
    signature,
    encoded,
  );
  assert(verified);
});

// Tests the "bad paths" as a temporary replacement for sign_verify/ecdsa WPT.
unitTest(async function testECDSASignVerifyFail() {
  const key = await window.crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-384",
    },
    true,
    ["sign", "verify"],
  );

  const encoded = new Uint8Array([1]);
  // Signing with a public key (InvalidAccessError)
  await assertThrowsAsync(async () => {
    await window.crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-384" },
      key.publicKey,
      new Uint8Array([1]),
    );
    throw new TypeError("unreachable");
  }, DOMException);

  // Do a valid sign for later verifying.
  const signature = await window.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-384" },
    key.privateKey,
    encoded,
  );

  // Verifying with a private key (InvalidAccessError)
  await assertThrowsAsync(async () => {
    await window.crypto.subtle.verify(
      { hash: { name: "SHA-384" }, name: "ECDSA" },
      key.privateKey,
      signature,
      encoded,
    );
    throw new TypeError("unreachable");
  }, DOMException);
});

// https://github.com/denoland/deno/issues/11313
unitTest(async function testSignRSASSAKey() {
  const subtle = window.crypto.subtle;
  assert(subtle);

  const keyPair = await subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  assert(keyPair.privateKey);
  assert(keyPair.publicKey);
  assertEquals(keyPair.privateKey.extractable, true);
  assert(keyPair.privateKey.usages.includes("sign"));

  const encoder = new TextEncoder();
  const encoded = encoder.encode("Hello, World!");

  const signature = await window.crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    keyPair.privateKey,
    encoded,
  );

  assert(signature);
});

// deno-fmt-ignore
const rawKey = new Uint8Array([
  1, 2, 3, 4, 5, 6, 7, 8,
  9, 10, 11, 12, 13, 14, 15, 16
]);

const jwk: JsonWebKey = {
  kty: "oct",
  // unpadded base64 for rawKey.
  k: "AQIDBAUGBwgJCgsMDQ4PEA",
  alg: "HS256",
  ext: true,
  "key_ops": ["sign"],
};

unitTest(async function subtleCryptoHmacImportExport() {
  const key1 = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "HMAC", hash: "SHA-256" },
    true,
    ["sign"],
  );
  const key2 = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "HMAC", hash: "SHA-256" },
    true,
    ["sign"],
  );
  const actual1 = await crypto.subtle.sign(
    { name: "HMAC" },
    key1,
    new Uint8Array([1, 2, 3, 4]),
  );

  const actual2 = await crypto.subtle.sign(
    { name: "HMAC" },
    key2,
    new Uint8Array([1, 2, 3, 4]),
  );
  // deno-fmt-ignore
  const expected = new Uint8Array([
    59, 170, 255, 216, 51, 141, 51, 194,
    213, 48, 41, 191, 184, 40, 216, 47,
    130, 165, 203, 26, 163, 43, 38, 71,
    23, 122, 222, 1, 146, 46, 182, 87,
  ]);
  assertEquals(
    new Uint8Array(actual1),
    expected,
  );
  assertEquals(
    new Uint8Array(actual2),
    expected,
  );

  const exportedKey1 = await crypto.subtle.exportKey("raw", key1);
  assertEquals(new Uint8Array(exportedKey1), rawKey);

  const exportedKey2 = await crypto.subtle.exportKey("jwk", key2);
  assertEquals(exportedKey2, jwk);
});

// https://github.com/denoland/deno/issues/12085
unitTest(async function generateImportHmacJwk() {
  const key = await crypto.subtle.generateKey(
    {
      name: "HMAC",
      hash: "SHA-512",
    },
    true,
    ["sign"],
  );
  assert(key);
  assertEquals(key.type, "secret");
  assertEquals(key.extractable, true);
  assertEquals(key.usages, ["sign"]);

  const exportedKey = await crypto.subtle.exportKey("jwk", key);
  assertEquals(exportedKey.kty, "oct");
  assertEquals(exportedKey.alg, "HS512");
  assertEquals(exportedKey.key_ops, ["sign"]);
  assertEquals(exportedKey.ext, true);
  assert(typeof exportedKey.k == "string");
  assertEquals(exportedKey.k.length, 171);
});

// 2048-bits publicExponent=65537
const pkcs8TestVectors = [
  // rsaEncryption
  "cli/tests/testdata/webcrypto/id_rsaEncryption.pem",
  // id-RSASSA-PSS
  "cli/tests/testdata/webcrypto/id_rsassaPss.pem",
];

unitTest({ perms: { read: true } }, async function importRsaPkcs8() {
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  for (const keyFile of pkcs8TestVectors) {
    const pem = await Deno.readTextFile(keyFile);
    const pemContents = pem.substring(
      pemHeader.length,
      pem.length - pemFooter.length,
    );
    const binaryDerString = atob(pemContents);
    const binaryDer = new Uint8Array(binaryDerString.length);
    for (let i = 0; i < binaryDerString.length; i++) {
      binaryDer[i] = binaryDerString.charCodeAt(i);
    }

    const key = await crypto.subtle.importKey(
      "pkcs8",
      binaryDer,
      { name: "RSA-PSS", hash: "SHA-256" },
      true,
      ["sign"],
    );

    assert(key);
    assertEquals(key.type, "private");
    assertEquals(key.extractable, true);
    assertEquals(key.usages, ["sign"]);
    const algorithm = key.algorithm as RsaHashedKeyAlgorithm;
    assertEquals(algorithm.name, "RSA-PSS");
    assertEquals(algorithm.hash.name, "SHA-256");
    assertEquals(algorithm.modulusLength, 2048);
    assertEquals(algorithm.publicExponent, new Uint8Array([1, 0, 1]));
  }
});

// deno-fmt-ignore
const asn1AlgorithmIdentifier = new Uint8Array([
  0x02, 0x01, 0x00, // INTEGER
  0x30, 0x0d, // SEQUENCE (2 elements)
  0x06, 0x09, // OBJECT IDENTIFIER
  0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, // 1.2.840.113549.1.1.1 (rsaEncryption)
  0x05, 0x00, // NULL
]);

unitTest(async function rsaExportPkcs8() {
  for (const algorithm of ["RSASSA-PKCS1-v1_5", "RSA-PSS", "RSA-OAEP"]) {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: algorithm,
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      algorithm !== "RSA-OAEP" ? ["sign", "verify"] : ["encrypt", "decrypt"],
    );

    assert(keyPair.privateKey);
    assert(keyPair.publicKey);
    assertEquals(keyPair.privateKey.extractable, true);

    const exportedKey = await crypto.subtle.exportKey(
      "pkcs8",
      keyPair.privateKey,
    );

    assert(exportedKey);
    assert(exportedKey instanceof ArrayBuffer);

    const pkcs8 = new Uint8Array(exportedKey);
    assert(pkcs8.length > 0);

    assertEquals(
      pkcs8.slice(4, asn1AlgorithmIdentifier.byteLength + 4),
      asn1AlgorithmIdentifier,
    );
  }
});

unitTest(async function testHkdfDeriveBits() {
  const rawKey = await crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "HKDF", hash: "SHA-256" },
    false,
    ["deriveBits"],
  );
  const salt = await crypto.getRandomValues(new Uint8Array(16));
  const info = await crypto.getRandomValues(new Uint8Array(16));
  const result = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt,
      info: info,
    },
    key,
    128,
  );
  assertEquals(result.byteLength, 128 / 8);
});

const jwtRSAKeys = {
  "2048": {
    size: 2048,
    publicJWK: {
      kty: "RSA",
      // unpadded base64 for rawKey.
      n: "09eVwAhT9SPBxdEN-74BBeEANGaVGwqH-YglIc4VV7jfhR2by5ivzVq8NCeQ1_ACDIlTDY8CTMQ5E1c1SEXmo_T7q84XUGXf8U9mx6uRg46sV7fF-hkwJR80BFVsvWxp4ahPlVJYj__94ft7rIVvchb5tyalOjrYFCJoFnSgq-i3ZjU06csI9XnO5klINucD_Qq0vUhO23_Add2HSYoRjab8YiJJR_Eths7Pq6HHd2RSXmwYp5foRnwe0_U75XmesHWDJlJUHYbwCZo0kP9G8g4QbucwU-MSNBkZOO2x2ZtZNexpHd0ThkATbnNlpVG_z2AGNORp_Ve3rlXwrGIXXw",
      e: "AQAB",
    },
    privateJWK: {
      kty: "RSA",
      // unpadded base64 for rawKey.
      n: "09eVwAhT9SPBxdEN-74BBeEANGaVGwqH-YglIc4VV7jfhR2by5ivzVq8NCeQ1_ACDIlTDY8CTMQ5E1c1SEXmo_T7q84XUGXf8U9mx6uRg46sV7fF-hkwJR80BFVsvWxp4ahPlVJYj__94ft7rIVvchb5tyalOjrYFCJoFnSgq-i3ZjU06csI9XnO5klINucD_Qq0vUhO23_Add2HSYoRjab8YiJJR_Eths7Pq6HHd2RSXmwYp5foRnwe0_U75XmesHWDJlJUHYbwCZo0kP9G8g4QbucwU-MSNBkZOO2x2ZtZNexpHd0ThkATbnNlpVG_z2AGNORp_Ve3rlXwrGIXXw",
      e: "AQAB",
      d: "H4xboN2co0VP9kXL71G8lUOM5EDis8Q9u8uqu_4U75t4rjpamVeD1vFMVfgOehokM_m_hKVnkkcmuNqj9L90ObaiRFPM5QxG7YkFpXbHlPAKeoXD1hsqMF0VQg_2wb8DhberInHA_rEA_kaVhHvavQLu7Xez45gf1d_J4I4931vjlCB6cupbLL0H5hHsxbMsX_5nnmAJdL_U3gD-U7ZdQheUPhDBJR2KeGzvnTm3KVKpOnwn-1Cd45MU4-KDdP0FcBVEuBsSrsQHliTaciBgkbyj__BangPj3edDxTkb-fKkEvhkXRjAoJs1ixt8nfSGDce9cM_GqAX9XGb4s2QkAQ",
      dp:
        "mM82RBwzGzi9LAqjGbi-badLtHRRBoH9sfMrJuOtzxRnmwBFccg_lwy-qAhUTqnN9kvD0H1FzXWzoFPFJbyi-AOmumYGpWm_PvzQGldne5CPJ02pYaeg-t1BePsT3OpIq0Am8E2Kjf9polpRJwIjO7Kx8UJKkhg5bISnsy0V8wE",
      dq:
        "ZlM4AvrWIpXwqsH_5Q-6BsLJdbnN_GypFCXoT9VXniXncSBZIWCkgDndBdWkSzyzIN65NiMRBfZaf9yduTFj4kvOPwb3ch3J0OxGJk0Ary4OGSlS1zNwMl93ALGal1FzpWUuiia9L9RraGqXAUr13L7TIIMRobRjpAV-z7M-ruM",
      p: "7VwGt_tJcAFQHrmDw5dM1EBru6fidM45NDv6VVOEbxKuD5Sh2EfAHfm5c6oouA1gZqwvKH0sn_XpB1NsyYyHEQd3sBVdK0zRjTo-E9mRP-1s-LMd5YDXVq6HE339nxpXsmO25slQEF6zBrj1bSNNXBFc7fgDnlq-HIeleMvsY_E",
      q: "5HqMHLzb4IgXhUl4pLz7E4kjY8PH2YGzaQfK805zJMbOXzmlZK0hizKo34Qqd2nB9xos7QgzOYQrNfSWheARwVsSQzAE0vGvw3zHIPP_lTtChBlCTPctQcURjw4dXcnK1oQ-IT321FNOW3EO-YTsyGcypJqJujlZrLbxYjOjQE8",
      qi:
        "OQXzi9gypDnpdHatIi0FaUGP8LSzfVH0AUugURJXs4BTJpvA9y4hcpBQLrcl7H_vq6kbGmvC49V-9I5HNVX_AuxGIXKuLZr5WOxPq8gLTqHV7X5ZJDtWIP_nq2NNgCQQyNNRrxebiWlwGK9GnX_unewT6jopI_oFhwp0Q13rBR0",
    },
  },
};

unitTest(async function testImportRsaJwk() {
  const subtle = window.crypto.subtle;
  assert(subtle);

  for (
    const [_key, jwkData] of Object.entries(jwtRSAKeys)
  ) {
    const { size, publicJWK, privateJWK } = jwkData;
    if (size != 2048) {
      continue;
    }

    // 1. Test import PSS
    for (const hash of ["SHA-1", "SHA-256", "SHA-384", "SHA-512"]) {
      const hashMapPSS: Record<string, string> = {
        "SHA-1": "PS1",
        "SHA-256": "PS256",
        "SHA-384": "PS384",
        "SHA-512": "PS512",
      };

      const privateKeyPSS = await crypto.subtle.importKey(
        "jwk",
        {
          alg: hashMapPSS[hash],
          ...privateJWK,
          ext: true,
          "key_ops": ["sign"],
        },
        { name: "RSA-PSS", hash },
        true,
        ["sign"],
      );

      const publicKeyPSS = await crypto.subtle.importKey(
        "jwk",
        {
          alg: hashMapPSS[hash],
          ...publicJWK,
          ext: true,
          "key_ops": ["verify"],
        },
        { name: "RSA-PSS", hash },
        true,
        ["verify"],
      );

      const signaturePSS = await crypto.subtle.sign(
        { name: "RSA-PSS", saltLength: 32 },
        privateKeyPSS,
        new Uint8Array([1, 2, 3, 4]),
      );

      const verifyPSS = await crypto.subtle.verify(
        { name: "RSA-PSS", saltLength: 32 },
        publicKeyPSS,
        signaturePSS,
        new Uint8Array([1, 2, 3, 4]),
      );
      assert(verifyPSS);
    }

    // 2. Test import PKCS1
    for (const hash of ["SHA-1", "SHA-256", "SHA-384", "SHA-512"]) {
      const hashMapPKCS1: Record<string, string> = {
        "SHA-1": "RS1",
        "SHA-256": "RS256",
        "SHA-384": "RS384",
        "SHA-512": "RS512",
      };

      const privateKeyPKCS1 = await crypto.subtle.importKey(
        "jwk",
        {
          alg: hashMapPKCS1[hash],
          ...privateJWK,
          ext: true,
          "key_ops": ["sign"],
        },
        { name: "RSASSA-PKCS1-v1_5", hash },
        true,
        ["sign"],
      );

      const publicKeyPKCS1 = await crypto.subtle.importKey(
        "jwk",
        {
          alg: hashMapPKCS1[hash],
          ...publicJWK,
          ext: true,
          "key_ops": ["verify"],
        },
        { name: "RSASSA-PKCS1-v1_5", hash },
        true,
        ["verify"],
      );

      const signaturePKCS1 = await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5", saltLength: 32 },
        privateKeyPKCS1,
        new Uint8Array([1, 2, 3, 4]),
      );

      const verifyPKCS1 = await crypto.subtle.verify(
        { name: "RSASSA-PKCS1-v1_5", saltLength: 32 },
        publicKeyPKCS1,
        signaturePKCS1,
        new Uint8Array([1, 2, 3, 4]),
      );
      assert(verifyPKCS1);
    }

    // 3. Test import OAEP
    for (
      const { hash, plainText } of hashPlainTextVector
    ) {
      const encryptAlgorithm = { name: "RSA-OAEP" };

      const hashMapOAEP: Record<string, string> = {
        "SHA-1": "RSA-OAEP",
        "SHA-256": "RSA-OAEP-256",
        "SHA-384": "RSA-OAEP-384",
        "SHA-512": "RSA-OAEP-512",
      };

      const privateKeyOAEP = await crypto.subtle.importKey(
        "jwk",
        {
          alg: hashMapOAEP[hash],
          ...privateJWK,
          ext: true,
          "key_ops": ["decrypt"],
        },
        { name: "RSA-OAEP", hash },
        true,
        ["decrypt"],
      );

      const publicKeyOAEP = await crypto.subtle.importKey(
        "jwk",
        {
          alg: hashMapOAEP[hash],
          ...publicJWK,
          ext: true,
          "key_ops": ["encrypt"],
        },
        { name: "RSA-OAEP", hash },
        true,
        ["encrypt"],
      );
      const cipherText = await subtle.encrypt(
        encryptAlgorithm,
        publicKeyOAEP,
        plainText,
      );

      assert(cipherText);
      assert(cipherText.byteLength > 0);
      assertEquals(cipherText.byteLength * 8, 2048);
      assert(cipherText instanceof ArrayBuffer);

      const decrypted = await subtle.decrypt(
        encryptAlgorithm,
        privateKeyOAEP,
        cipherText,
      );
      assert(decrypted);
      assert(decrypted instanceof ArrayBuffer);
      assertEquals(new Uint8Array(decrypted), plainText);
    }
  }
});
