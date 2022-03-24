// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.

/// <reference path="../../core/internal.d.ts" />

((window) => {
  const core = window.Deno.core;
  const webidl = window.__bootstrap.webidl;
  const { DOMException } = window.__bootstrap.domException;
  const { defineEventHandler, _canceledFlag } = window.__bootstrap.event;
  const { assert } = window.__bootstrap.infra;
  const { Deferred } = window.__bootstrap.streams;
  const {
    NumberIsNaN,
    ArrayIsArray,
    Date,
    SafeArrayIterator,
    ObjectPrototypeHasOwnProperty,
    DatePrototypeGetMilliseconds,
    MapPrototypeGet,
    MapPrototypeDelete,
    ArrayPrototypeSort,
    Set,
    SetPrototypeHas,
    SetPrototypeAdd,
    MathMin,
    MathFloor,
    MapPrototypeKeys,
  } = window.__bootstrap.primordials;

  webidl.converters.IDBTransactionMode = webidl.createEnumConverter(
    "IDBTransactionMode",
    [
      "readonly",
      "readwrite",
      "versionchange",
    ],
  );

  webidl.converters.IDBTransactionDurability = webidl.createEnumConverter(
    "IDBTransactionDurability",
    [
      "default",
      "strict",
      "relaxed",
    ],
  );

  webidl.converters.IDBTransactionOptions = webidl.createDictionaryConverter(
    "IDBTransactionOptions",
    [
      {
        key: "durability",
        converter: webidl.converters.IDBTransactionDurability,
        defaultValue: "default",
      },
    ],
  );

  webidl.converters.IDBObjectStoreParameters = webidl.createDictionaryConverter(
    "IDBObjectStoreParameters",
    [
      {
        key: "keyPath",
        converter: webidl.createNullableConverter(
          webidl.converters["sequence<DOMString> or DOMString"],
        ),
        defaultValue: null,
      },
      {
        key: "autoIncrement",
        converter: webidl.converters.boolean,
        defaultValue: false,
      },
    ],
  );

  webidl.converters.IDBCursorDirection = webidl.createEnumConverter(
    "IDBCursorDirection",
    [
      "next",
      "nextunique",
      "prev",
      "prevunique",
    ],
  );

  webidl.converters.IDBIndexParameters = webidl.createDictionaryConverter(
    "IDBIndexParameters",
    [
      {
        key: "unique",
        converter: webidl.converters.boolean,
        defaultValue: false,
      },
      {
        key: "multiEntry",
        converter: webidl.converters.boolean,
        defaultValue: false,
      },
    ],
  );

  /**
   * @param input {any}
   * @param seen {Set<any>}
   * @returns {(Key | null)}
   */
  // Ref: https://w3c.github.io/IndexedDB/#convert-a-value-to-a-key
  function valueToKey(input, seen = new Set()) {
    if (SetPrototypeHas(seen, input)) {
      return null;
    }
    if (webidl.type(input) === "Number") {
      if (NumberIsNaN(input)) {
        return null;
      } else {
        return {
          type: "number",
          value: input,
        };
      }
    } else if (input instanceof Date) {
      const ms = DatePrototypeGetMilliseconds(input);
      if (NumberIsNaN(ms)) {
        return null;
      } else {
        return {
          type: "date",
          value: input,
        };
      }
    } else if (webidl.type(input) === "String") {
      return {
        type: "string",
        value: input,
      };
    } else if (false) { // TODO: is a buffer source type
      return {
        type: "binary",
        value: input.slice(),
      };
    } else if (ArrayIsArray(input)) {
      SetPrototypeAdd(seen, input);
      const keys = [];
      for (const entry of input) {
        const key = valueToKey(entry, seen);
        if (key === null) {
          return null;
        }
        keys.push(key);
      }
      return {
        type: "array",
        value: keys,
      };
    } else {
      return null;
    }
  }

  // Ref: https://w3c.github.io/IndexedDB/#convert-a-value-to-a-multientry-key
  function valueToMultiEntryKey(input) {
    if (ArrayIsArray(input)) {
      const seen = new Set([input]);
      const keys = [];
      for (const entry of input) {
        const key = valueToKey(entry, seen);
        if (
          key !== null &&
          keys.find((item) => compareTwoKeys(item, key)) === undefined
        ) {
          keys.push(key);
        }
      }
      return {
        type: "array",
        value: keys,
      };
    } else {
      return valueToKey(input);
    }
  }

  // Ref: https://w3c.github.io/IndexedDB/#convert-a-value-to-a-key-range
  function valueToKeyRange(value, nullDisallowed) {
    if (value instanceof IDBKeyRange) {
      return value;
    }
    if (value === undefined || value === null) {
      if (nullDisallowed) {
        throw new DOMException("", "DataError");
      } else {
        return createRange(null, null);
      }
    }
    const key = valueToKey(value);
    if (key === null) {
      throw new DOMException("", "DataError");
    }
    return createRange(key, key);
  }

  // Ref: https://w3c.github.io/IndexedDB/#compare-two-keys
  function compareTwoKeys(a, b) {
    const { type: ta, value: va } = a;
    const { type: tb, value: vb } = b;

    if (ta !== tb) {
      if (ta === "array") {
        return 1;
      } else if (tb === "array") {
        return -1;
      } else if (ta === "binary") {
        return 1;
      } else if (tb === "binary") {
        return -1;
      } else if (ta === "string") {
        return 1;
      } else if (tb === "string") {
        return -1;
      } else if (ta === "number") {
        return 1;
      } else if (tb === "number") {
        return -1;
      } else if (ta === "date") {
        return 1;
      } else {
        assert(tb === "date");
        return -1;
      }
    }

    switch (ta) {
      case "number":
      case "date": {
        if (va > vb) {
          return 1;
        } else if (va < vb) {
          return -1;
        } else {
          return 0;
        }
      }
      case "string": {
        if (va < vb) {
          return -1;
        } else if (vb < va) {
          return 1;
        } else {
          return 0;
        }
      }
      case "binary": {
        if (va < vb) {
          return -1;
        } else if (vb < va) {
          return -1;
        } else {
          return 0;
        }
      }
      case "array": {
        const len = MathMin(va.length, vb.length);
        for (let i = 0; i < len; i++) {
          const c = compareTwoKeys(va[i], vb[i]);
          if (c !== 0) {
            return c;
          }
        }
        if (va.length > vb.length) {
          return 1;
        } else if (va.length < vb.length) {
          return -1;
        } else {
          return 0;
        }
      }
    }
  }

  // Ref: https://w3c.github.io/IndexedDB/#convert-a-key-to-a-value
  function keyToValue(key) {
    switch (key.type) {
      case "number":
        return Number(key.value);
      case "string":
        return String(key.value);
      case "date":
        return new Date(key.value);
      case "binary":
        return new Uint8Array(key.value).buffer; // TODO: check
      case "array": {
        return key.value.map(keyToValue);
      }
    }
  }

  // Ref: https://w3c.github.io/IndexedDB/#valid-key-path
  function isValidKeyPath(key) {
    if (typeof key === "string" && key.length === 0) {
      return true;
    } else {
      // TODO: complete implementation
    }
  }

  // Ref: https://w3c.github.io/IndexedDB/#check-that-a-key-could-be-injected-into-a-value
  function checkKeyCanBeInjectedIntoValue(value, keyPath) {
    const identifiers = keyPath.split(".");
    assert(identifiers.length !== 0);
    identifiers.pop();
    for (const identifier of identifiers) {
      if (webidl.type(value) !== "Object") {
        return false;
      }
      if (!ObjectPrototypeHasOwnProperty(value, identifier)) {
        return true;
      }
      value = value[identifier];
    }
    return webidl.type(value) === "Object";
  }

  // Ref: https://w3c.github.io/IndexedDB/#inject-a-key-into-a-value-using-a-key-path
  function injectKeyIntoValueUsingKeyPath(value, key, keyPath) {
    const identifiers = keyPath.split(".");
    assert(identifiers.length !== 0);
    const last = identifiers.pop();
    for (const identifier of identifiers) {
      assert(webidl.type(value) === "Object");
      if (!ObjectPrototypeHasOwnProperty(value, identifier)) {
        value[identifier] = {};
      }
      value = value[identifier];
    }
    assert(webidl.type(value) === "Object");
    value[last] = keyToValue(key);
  }

  // Ref: https://w3c.github.io/IndexedDB/#clone
  function clone(transaction, value) {
    assert(transaction[_state] === "active");
    transaction[_state] = "inactive";
    // TODO: 3., 4.: what is StructuredSerializeForStorage? Do we have it?
    transaction[_state] = "active";
    // TODO: 6.
  }

  // Ref: https://w3c.github.io/IndexedDB/#abort-a-transaction
  function abortTransaction(transaction, error) {
    // TODO: 1.:refactors ops to use sqlite transactions and use a resource
    if (transaction[_mode] === "versionchange") {
      abortUpgradeTransaction(transaction);
    }
    transaction[_state] = "finished";
    if (error !== null) {
      transaction[_error] = error;
    }
    for (const request of transaction[_requestList]) {
      // TODO: abort the steps to asynchronously execute a request
      request[_processed] = true;
      request[_done] = true;
      request[_result] = undefined;
      request[_error] = new DOMException("", "AbortError");
      request.dispatchEvent(
        new Event("error", {
          bubbles: true,
          cancelable: true,
        }),
      );
    }
    if (transaction[_mode] === "versionchange") {
      // TODO: 6.1.: figure out connection & database structures
    }
    transaction.dispatchEvent(
      new Event("abort", {
        bubbles: true,
      }),
    );
    if (transaction[_mode] === "versionchange") {
      // TODO: 6.3.: the transaction should have an openrequest, but the spec doesnt specify this ever
    }
  }

  // Ref: https://w3c.github.io/IndexedDB/#abort-an-upgrade-transaction
  function abortUpgradeTransaction(transaction) {
    // TODO: figure out connection & database structures
  }

  const _failure = Symbol("failure");
  // Ref: https://w3c.github.io/IndexedDB/#extract-a-key-from-a-value-using-a-key-path
  function extractKeyFromValueUsingKeyPath(value, keyPath, multiEntry) {
    const r = evaluateKeyPathOnValue(value, keyPath);
    if (r === _failure) {
      return _failure;
    }
    return valueToKey(!multiEntry ? r : valueToMultiEntryKey(r));
  }

  // Ref: https://w3c.github.io/IndexedDB/#evaluate-a-key-path-on-a-value
  function evaluateKeyPathOnValue(value, keyPath) {
    if (ArrayIsArray(keyPath)) {
      const result = [];
      for (let i = 0; i < keyPath.length; i++) {
        const key = evaluateKeyPathOnValue(value, keyPath[i]); // spec is wrong, arguments are reversed.
        if (key === _failure) {
          return _failure;
        }
        result[i] = key;
      }
      return result;
    }
    if (keyPath === "") {
      return value;
    }
    const identifiers = keyPath.split(".");
    for (const identifier of identifiers) {
      if (webidl.type(value) === "String" && identifier === "length") {
        value = value.length;
      } else if (ArrayIsArray(value) && identifier === "length") {
        value = value.length;
      } else if (value instanceof Blob && identifier === "size") {
        value = value.size;
      } else if (value instanceof Blob && identifier === "type") {
        value = value.type;
      } else if (value instanceof File && identifier === "name") {
        value = value.name;
      } else if (value instanceof File && identifier === "lastModified") {
        value = value.lastModified;
      } else {
        if (type(value) !== "Object") {
          return _failure;
        }
        if (!ObjectPrototypeHasOwnProperty(value, identifier)) {
          return _failure;
        }
        value = value[identifier];
        if (value === undefined) {
          return _failure;
        }
      }
    }
    return value;
  }

  // Ref: https://w3c.github.io/IndexedDB/#asynchronously-execute-a-request
  function asynchronouslyExecuteRequest(source, operation, request) {
    assert(source[_transaction][_state] === "active");
    if (!request) {
      request = new IDBRequest();
      request[_source] = source;
    }
    source[_transaction][_requestList].push(request);

    // TODO: use .then
    (async () => {
      // TODO: 5.1
      let errored = false;
      let result;
      try {
        result = await operation();
      } catch (e) {
        if (source[_transaction][_state] === "committing") {
          abortTransaction(source[_transaction], e);
          return;
        } else {
          result = e;
          // TODO: revert changes made by operation
          errored = true;
        }
      }
      request[_processed] = true;
      source[_transaction][_requestList].slice(
        source[_transaction][_requestList].findIndex((r) => r === request),
        1,
      );
      request[_done] = true;
      if (errored) {
        request[_result] = undefined;
        request[_error] = result;

        // Ref: https://w3c.github.io/IndexedDB/#fire-an-error-event
        // TODO(@crowlKats): support legacyOutputDidListenersThrowFlag
        const event = new Event("error", {
          bubbles: true,
          cancelable: true,
        });
        if (request[_transaction][_state] === "inactive") {
          request[_transaction][_state] = "active";
        }
        request.dispatchEvent(event);
        if (request[_transaction][_state] === "active") {
          request[_transaction][_state] = "inactive";
          if (!event[_canceledFlag]) {
            abortTransaction(request[_transaction], request[_error]);
            return;
          }
          if (request[_transaction][_requestList].length === 0) {
            commitTransaction(request[_transaction]);
          }
        }
      } else {
        request[_result] = result;
        request[_error] = undefined;

        // Ref: https://w3c.github.io/IndexedDB/#fire-a-success-event
        // TODO(@crowlKats): support legacyOutputDidListenersThrowFlag
        const event = new Event("success", {
          bubbles: false,
          cancelable: false,
        });
        if (request[_transaction][_state] === "inactive") {
          request[_transaction][_state] = "active";
        }
        request.dispatchEvent(event);
        if (request[_transaction][_state] === "active") {
          request[_transaction][_state] = "inactive";
          if (request[_transaction][_requestList].length === 0) {
            commitTransaction(request[_transaction]);
          }
        }
      }
    })();
    return request;
  }

  // Ref: https://w3c.github.io/IndexedDB/#commit-a-transaction
  // TODO: this is all very weird, and not sure how integrates with sqlite transactions
  function commitTransaction(transaction) {
    transaction[_state] = "committing";
    (async () => {
      for (const request of transaction[_requestList]) {
        await request[_processedDeferred].promise;
      }
      if (transaction[_state] !== "committing") {
        return;
      }
      // TODO: 2.3., 2.4.

      if (transaction[_mode] === "versionchange") {
        // TODO: 2.5.1.: figure out connection & database structures
      }
      transaction[_state] = "finished";
      transaction.dispatchEvent(new Event("complete"));
      if (transaction[_mode] === "versionchange") {
        transaction[_request][_transaction] = null;
      }
    })();
  }

  const _result = Symbol("[[result]]");
  const _error = Symbol("[[error]]");
  const _source = Symbol("[[source]]");
  const _transaction = Symbol("[[transaction]]");
  const _processed = Symbol("[[processed]]");
  const _processedDeferred = Symbol("[[processedDeferred]]");
  const _done = Symbol("[[done]]");
  // Ref: https://w3c.github.io/IndexedDB/#idbrequest
  class IDBRequest extends EventTarget {
    constructor() {
      super();
      webidl.illegalConstructor();
    }

    [_processedDeferred] = new Deferred();
    [_processed];
    [_done] = false;

    [_result];
    // Ref: https://w3c.github.io/IndexedDB/#dom-idbrequest-result
    get result() {
      webidl.assertBranded(this, IDBRequestPrototype);
      if (!this[_done]) {
        throw new DOMException("", "InvalidStateError");
      }
      if (this[_error]) {
        return undefined;
      } else {
        return this[_result];
      }
    }

    [_error] = null;
    get error() {
      webidl.assertBranded(this, IDBRequestPrototype);
      if (!this[_done]) {
        throw new DOMException("", "InvalidStateError");
      }
      return this[_error];
    }

    [_source] = null;
    get source() {
      webidl.assertBranded(this, IDBRequestPrototype);
      return this[_source];
    }

    [_transaction] = null;
    get transaction() {
      webidl.assertBranded(this, IDBRequestPrototype);
      return this[_transaction];
    }

    get readyState() {
      webidl.assertBranded(this, IDBRequestPrototype);
      return this[_done] ? "done" : "pending";
    }
  }
  defineEventHandler(IDBRequest.prototype, "success");
  defineEventHandler(IDBRequest.prototype, "error");

  webidl.configurePrototype(IDBRequest);
  const IDBRequestPrototype = IDBRequest.prototype;

  // Ref: https://w3c.github.io/IndexedDB/#idbopendbrequest
  class IDBOpenDBRequest extends IDBRequest {
    constructor() {
      super();
      webidl.illegalConstructor();
    }
  }
  defineEventHandler(IDBOpenDBRequest.prototype, "blocked");
  defineEventHandler(IDBOpenDBRequest.prototype, "upgradeneeded");

  webidl.configurePrototype(IDBOpenDBRequest);

  // Ref: https://w3c.github.io/IndexedDB/#open-a-database
  function openDatabase(name, version) {
    // TODO: figure out connection & database structures
  }

  // Ref: https://w3c.github.io/IndexedDB/#delete-a-database
  function deleteDatabase(name, request) {
    // TODO: figure out connection & database structures
  }

  // Ref: https://w3c.github.io/IndexedDB/#idbfactory
  class IDBFactory {
    constructor() {
      webidl.illegalConstructor();
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbfactory-open
    open(name, version = undefined) {
      webidl.assertBranded(this, IDBFactoryPrototype);
      const prefix = "Failed to execute 'open' on 'IDBFactory'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      name = webidl.converters.DOMString(name, {
        prefix,
        context: "Argument 1",
      });
      if (version !== undefined) {
        version = webidl.converters["unsigned long long"](version, {
          prefix,
          context: "Argument 2",
          enforceRange: true,
        });
      }

      if (version === 0) {
        throw new TypeError();
      }

      const request = webidl.createBranded(IDBOpenDBRequest);

      (async () => {
        try {
          const res = openDatabase(name, version);
          request[_result] = res;
          request[_done] = true;
          request.dispatchEvent(new Event("success"));
        } catch (e) {
          request[_result] = undefined;
          request[_error] = e;
          request[_done] = true;
          request.dispatchEvent(
            new Event("error", {
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      })();

      return request;
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbfactory-deletedatabase
    deleteDatabase(name) {
      webidl.assertBranded(this, IDBFactoryPrototype);
      const prefix = "Failed to execute 'deleteDatabase' on 'IDBFactory'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      name = webidl.converters.DOMString(name, {
        prefix,
        context: "Argument 1",
      });

      const request = webidl.createBranded(IDBOpenDBRequest);

      (async () => {
        try {
          const res = deleteDatabase(name, request);
          request[_processed] = true;
          request[_result] = undefined;
          request[_done] = true;
          request.dispatchEvent(
            new IDBVersionChangeEvent("success", {
              bubbles: false,
              cancelable: false,
              oldVersion: res,
              newVersion: null,
            }),
          );
        } catch (e) {
          request[_processed] = true;
          request[_error] = e;
          request[_done] = true;
          request.dispatchEvent(
            new Event("error", {
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      })();

      return request;
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbfactory-databases
    databases() {
      webidl.assertBranded(this, IDBFactoryPrototype);
      return core.opAsync("op_indexeddb_list_databases");
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbfactory-cmp
    cmp(first, second) {
      webidl.assertBranded(this, IDBFactoryPrototype);
      const prefix = "Failed to execute 'cmp' on 'IDBFactory'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      first = webidl.converters.any(first, {
        prefix,
        context: "Argument 1",
      });

      second = webidl.converters.any(second, {
        prefix,
        context: "Argument 2",
      });

      const a = valueToKey(first);
      if (a === null) {
        throw new DOMException(
          "Data provided does not meet requirements",
          "DataError",
        );
      }
      const b = valueToKey(second);
      if (b === null) {
        throw new DOMException(
          "Data provided does not meet requirements",
          "DataError",
        );
      }

      return compareTwoKeys(a, b);
    }
  }
  webidl.configurePrototype(IDBFactory);
  const IDBFactoryPrototype = IDBFactory.prototype;

  // Ref: https://w3c.github.io/IndexedDB/#database-connection
  class Connection {
    /** @type {Set<IDBDatabase>} */
    databases = new Set();
    /** @type {number} */
    version;
    /** @type {boolean} */
    closePending = false;
    /** @type {Map<String, IDBObjectStore>} */
    objectStoreSet;

    /**
     * @param forced {boolean}
     */
    // Ref: https://w3c.github.io/IndexedDB/#close-a-database-connection
    close(forced) {
      this.closePending = true;
      if (forced) {
        // TODO: 2: somehow get all transactions
      }
      // TODO: 3.: somehow get all transactions
      if (forced) {
        // TODO: 4.: where is this event listened from? makes no sense
      }
    }
  }

  /** @type {Set<Connection>} */
  const connections = new Set();

  const _name = Symbol("[[name]]");
  const _version = Symbol("[[version]]");
  const _closePending = Symbol("[[closePending]]");
  const _objectStores = Symbol("[[objectStores]]");
  const _upgradeTransaction = Symbol("[[upgradeTransaction]]");
  const _connection = Symbol("[[connection]]");
  // Ref: https://w3c.github.io/IndexedDB/#idbdatabase
  // TODO: finalizationRegistry: If an IDBDatabase object is garbage collected, the associated connection must be closed.
  class IDBDatabase extends EventTarget {
    /** @type {boolean} */
    [_closePending] = false;
    /** @type {Set<ObjectStore>} */
    [_objectStores] = new Set();
    /** @type {(IDBTransaction | null)} */
    [_upgradeTransaction] = null;
    /** @type {Connection} */
    [_connection];

    constructor() {
      super();
      webidl.illegalConstructor();
    }

    [_name];
    // Ref: https://w3c.github.io/IndexedDB/#dom-idbdatabase-name
    get name() {
      webidl.assertBranded(this, IDBDatabasePrototype);
      return this[_name];
    }

    [_version];
    // Ref: https://w3c.github.io/IndexedDB/#dom-idbdatabase-version
    get version() {
      webidl.assertBranded(this, IDBDatabasePrototype);
      return this[_version];
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbdatabase-objectstorenames
    get objectStoreNames() {
      webidl.assertBranded(this, IDBDatabasePrototype);
      return ArrayPrototypeSort([
        ...new SafeArrayIterator(
          MapPrototypeKeys(this[_connection].objectStoreSet),
        ),
      ]);
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbdatabase-transaction
    transaction(storeNames, mode = "readonly", options = {}) {
      webidl.assertBranded(this, IDBDatabasePrototype);
      const prefix = "Failed to execute 'transaction' on 'IDBDatabase'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      storeNames = webidl.converters["sequence<DOMString> or DOMString"](
        storeNames,
        {
          prefix,
          context: "Argument 1",
        },
      );
      mode = webidl.converters.IDBTransactionMode(mode, {
        prefix,
        context: "Argument 2",
      });
      options = webidl.converters.IDBTransactionOptions(options, {
        prefix,
        context: "Argument 3",
      });

      if (this[_closePending]) {
        throw new DOMException("", "InvalidStateError");
      }
      const scope = new Set(
        ArrayIsArray(storeNames) ? storeNames : [storeNames],
      );
      // TODO: 4.: should this be an op? should the names be cached?
      if (scope.size === 0) {
        throw new DOMException("", "InvalidAccessError");
      }
      if (mode !== "readonly" && mode !== "readwrite") {
        throw new TypeError("");
      }
      const transaction = webidl.createBranded(IDBTransaction);
      // TODO: connection: figure out connection & database structures
      transaction[_mode] = mode;
      transaction[_durabilityHint] = options.durability;
      // TODO: scope: figure out connection & database structures
      return transaction;
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbdatabase-close
    close() {
      webidl.assertBranded(this, IDBDatabasePrototype);
      this[_connection].close(false);
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbdatabase-createobjectstore
    createObjectStore(name, options = {}) {
      webidl.assertBranded(this, IDBDatabasePrototype);
      const prefix = "Failed to execute 'createObjectStore' on 'IDBDatabase'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      name = webidl.converters.DOMString(name, {
        prefix,
        context: "Argument 1",
      });
      options = webidl.converters.IDBObjectStoreParameters(options, {
        prefix,
        context: "Argument 2",
      });

      if (this[_upgradeTransaction] === null) {
        throw new DOMException(
          "No upgrade transaction present",
          "InvalidStateError",
        );
      }

      if (this[_upgradeTransaction][_state] !== "active") {
        throw new DOMException(
          "Upgrade transaction is not active",
          "TransactionInactiveError",
        );
      }

      const keyPath = options.keyPath ?? null;

      if (options.keyPath !== null && !isValidKeyPath(options.keyPath)) {
        throw new DOMException("", "SyntaxError");
      }

      if (
        options.autoIncrement &&
        ((typeof options.keyPath === "string" &&
          options.keyPath.length === 0) ||
          ArrayIsArray(options.keyPath))
      ) {
        throw new DOMException("", "InvalidAccessError");
      }

      core.opSync(
        "op_indexeddb_database_create_object_store",
        this[_name],
        name,
        // TODO: keypath: probably an enum, since it can be a string or array of strings and there is different behaviour depending on type
      );

      const store = new Store(options.autoIncrement);
      store.name = name;
      store.database = this;
      store.keyPath = keypath;
      const objectStore = webidl.createBranded(IDBObjectStore);
      objectStore[_name] = name; // TODO: objectstore name is inconsistent throughout the spec
      objectStore[_store] = store;
      objectStore[_transaction] = this[_upgradeTransaction];
      return objectStore;
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbdatabase-deleteobjectstore
    deleteObjectStore(name) {
      webidl.assertBranded(this, IDBDatabasePrototype);
      const prefix = "Failed to execute 'deleteObjectStore' on 'IDBDatabase'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      name = webidl.converters.DOMString(name, {
        prefix,
        context: "Argument 1",
      });

      if (this[_upgradeTransaction] === null) {
        throw new DOMException("", "InvalidStateError");
      }

      if (this[_upgradeTransaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }

      const store = MapPrototypeGet(this[_connection].objectStoreSet, name);
      if (store === undefined) {
        throw new DOMException("", "NotFoundError");
      }
      MapPrototypeDelete(this[_connection].objectStoreSet, name);

      // TODO 6.: ops
    }
  }
  defineEventHandler(IDBDatabase.prototype, "abort");
  defineEventHandler(IDBDatabase.prototype, "close");
  defineEventHandler(IDBDatabase.prototype, "error");
  defineEventHandler(IDBDatabase.prototype, "versionchange");

  webidl.configurePrototype(IDBDatabase);
  const IDBDatabasePrototype = IDBDatabase.prototype;

  class Store {
    /** @type {string} */
    name;
    /** @type {IDBDatabase} */
    database;

    keyPath; // TODO: should this be here? or somewhere else?

    /** @type {null | KeyGenerator} */
    keyGenerator = null;

    constructor(generator) {
      if (generator) {
        // Ref: https://w3c.github.io/IndexedDB/#key-generator-construct
        this.keyGenerator = {
          current: 1,
          // Ref: https://w3c.github.io/IndexedDB/#generate-a-key
          generateKey() {
            if (this.current > 9007199254740992) {
              throw new DOMException("", "ConstraintError");
            }
            return {
              type: "number",
              value: this.current++,
            };
          },
          // Ref: https://w3c.github.io/IndexedDB/#possibly-update-the-key-generator
          possiblyUpdate(key) {
            if (key.type !== "number") {
              return;
            }
            const value = MathFloor(MathMin(key.value, 9007199254740992));
            if (value >= this.current) {
              this.current = value + 1;
            }
          },
        };
      }
    }
  }

  // Ref: https://w3c.github.io/IndexedDB/#store-a-record-into-an-object-store
  function storeRecordIntoObjectStore(store, value, key, noOverwrite) {
    if (store.keyGenerator !== null) {
      if (key === undefined) {
        key = store.keyGenerator.generateKey();
        if (store.keyPath !== null) {
          injectKeyIntoValueUsingKeyPath(value, key, store.keyPath);
        }
      } else {
        store.keyGenerator.possiblyUpdate(key);
      }
    }

    const indexes = core.opSync(
      "op_indexeddb_object_store_add_or_put_records",
      store.database.name,
      store.name,
      core.deserialize(value),
      key,
      noOverwrite,
    );

    for (const index of indexes) {
      let indexKey;
      try {
        indexKey = extractKeyFromValueUsingKeyPath(
          value,
          index.keyPath,
          index.multiEntry,
        );
        if (indexKey === null || indexKey === _failure) {
          continue;
        }
      } catch (e) {}
      core.opSync(
        "op_indexeddb_object_store_add_or_put_records_handle_index",
        index,
        indexKey,
      );
    }

    return key;
  }

  // Ref: https://w3c.github.io/IndexedDB/#add-or-put
  function addOrPut(handle, value, key, noOverwrite) {
    // TODO: 3.: source has been deleted

    if (handle[_transaction][_state] !== "active") {
      throw new DOMException("", "TransactionInactiveError");
    }

    if (handle[_transaction][_mode] !== "readonly") {
      throw new DOMException("", "ReadOnlyError");
    }

    if (handle[_store].keyPath !== null && key !== undefined) {
      throw new DOMException("", "DataError");
    }

    if (
      handle[_store].keyPath === null && handle[_store].keyGenerator === null &&
      key === undefined
    ) {
      throw new DOMException("", "DataError");
    }

    if (key !== undefined) {
      const r = valueToKey(key);
      if (r === null) {
        throw new DOMException("", "DataError");
      }
      key = r;
    }
    const cloned = clone(handle[_transaction], value);

    if (handle[_store].keyPath !== null) {
      const kpk = extractKeyFromValueUsingKeyPath(
        cloned,
        handle[_store].keyPath,
      );
      if (kpk === null) {
        throw new DOMException("", "DataError");
      }
      if (kpk !== _failure) {
        key = kpk;
      } else {
        if (handle[_store].keyGenerator === null) {
          throw new DOMException("", "DataError");
        } else {
          if (!checkKeyCanBeInjectedIntoValue(cloned, handle[_store].keyPath)) {
            throw new DOMException("", "DataError");
          }
        }
      }
    }

    return asynchronouslyExecuteRequest(
      handle,
      () =>
        storeRecordIntoObjectStore(handle[_store], cloned, key, noOverwrite),
    );
  }

  // Ref: https://w3c.github.io/IndexedDB/#delete-records-from-an-object-store
  function deleteRecordsFromObjectStore(store, range) {
    core.opSync(
      "op_indexeddb_object_store_delete_records",
      store.database.name,
      store.name,
      range,
    );
    return undefined;
  }

  // Ref: https://w3c.github.io/IndexedDB/#clear-an-object-store
  function clearObjectStore(store) {
    core.opSync(
      "op_indexeddb_object_store_clear",
      store.database.name,
      store.name,
    );
    return undefined;
  }

  // Ref: https://w3c.github.io/IndexexdDB/#retrieve-a-value-from-an-object-store
  function retrieveValueFromObjectStore(store, range) {
    const val = core.opSync(
      "op_indexeddb_object_store_retrieve_value",
      store.database.name,
      store.name,
      range,
    );
    if (val === null) {
      return undefined;
    } else {
      return core.deserialize(val);
    }
  }

  // Ref: https://w3c.github.io/IndexedDB/#retrieve-multiple-values-from-an-object-store
  function retrieveMultipleValuesFromObjectStore(store, range, count) {
    const vals = core.opSync(
      "op_indexeddb_object_store_retrieve_multiple_values",
      store.database.name,
      store.name,
      range,
      count,
    );
    return vals.map((val) => core.deserialize(val));
  }

  // Ref: https://w3c.github.io/IndexedDB/#retrieve-a-key-from-an-object-store
  function retrieveKeyFromObjectStore(store, range) {
    const val = core.opSync(
      "op_indexeddb_object_store_retrieve_key",
      store.database.name,
      store.name,
      range,
    );
    if (val === null) {
      return undefined;
    } else {
      return keyToValue(val);
    }
  }

  // Ref: https://w3c.github.io/IndexedDB/#retrieve-multiple-keys-from-an-object-store
  function retrieveMultipleKeysFromObjectStore(store, range, count) {
    const vals = core.opSync(
      "op_indexeddb_object_store_retrieve_multiple_keys",
      store.database.name,
      store.name,
      range,
      count,
    );
    return vals.map((val) => keyToValue(val));
  }

  // Ref: https://w3c.github.io/IndexedDB/#count-the-records-in-a-range
  function countRecordsInRange(storeOrIndex, range) {
    if (storeOrIndex instanceof Store) {
      return core.opSync(
        "op_indexeddb_object_store_count_records",
        storeOrIndex.database.name,
        storeOrIndex.name,
        range,
      );
    } else {
      assert(storeOrIndex instanceof Index);
      return core.opSync(
        "op_indexeddb_object_store_count_records",
        storeOrIndex.database.name,
        storeOrIndex.name,
        range,
      );
    }
  }

  // Ref: https://w3c.github.io/IndexedDB/#iterate-a-cursor
  function iterateCursor(cursor, key, primaryKey, count = 1) {
    if (primaryKey !== undefined) {
      assert(
        cursor[_source] instanceof IDBIndex &&
          (cursor[_direction] === "next" || cursor[_direction] === "prev"),
      );
    }
    // TODO: 4.: this and following tODOs are to do with ops
    let position = cursor[_position];
    let objectStorePosition = cursor[_objectStorePosition];
    for (; count > 0; count--) {
      // TODO: 9.1.
      if (res === undefined) {
        if (cursor[_source] instanceof IDBIndex) {
          cursor[_objectStorePosition] = undefined;
        }
        if (!cursor[_keyOnly]) {
          cursor[_value] = undefined;
        }
        return null;
      }
      // TODO: 9.3., 9.4.
    }
    cursor[_position] = position;
    if (cursor[_source] instanceof IDBIndex) {
      cursor[_objectStorePosition] = objectStorePosition;
    }
    // TODO: 12.
    if (!cursor[_keyOnly]) {
      // TODO: 13.1., 13.2.
    }
    cursor[_gotValue] = true;
    return cursor;
  }

  const _keyPath = Symbol("[[keyPath]]");
  const _store = Symbol("[[store]]");
  // Ref: https://w3c.github.io/IndexedDB/#idbobjectstore
  class IDBObjectStore {
    constructor() {
      webidl.illegalConstructor();
    }

    /** @type {IDBTransaction} */
    [_transaction];
    /** @type {Store} */
    [_store];

    [_name];
    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-name
    get name() {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      return this[_name];
    }

    // Ref: https://w3c.github.io/IndexedDB/#ref-for-dom-idbobjectstore-name%E2%91%A2
    set name(name) {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      name = webidl.converters.DOMString(name, {
        prefix: "Failed to set 'name' on 'IDBObjectStore'",
        context: "Argument 1",
      });

      // TODO: 4.: source has been deleted

      if (this[_transaction][_mode] !== "versionchange") {
        throw new DOMException("", "InvalidStateError");
      }

      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }

      if (this[_store][_name] === name) {
        return;
      }

      core.opSync(
        "op_indexeddb_object_store_rename",
        this[_store].database.name,
        this[_name],
        name,
      );
      this[_store].name = name;
      this[_name] = name;
    }

    [_keyPath];
    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-keypath
    get keyPath() {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      return this[_keyPath]; // TODO: convert?
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-indexnames
    get indexNames() {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      // TODO: op maybe? or caching?
    }

    [_transaction];
    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-transaction
    get transaction() {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      return this[_transaction];
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-autoincrement
    get autoIncrement() {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      return this[_store].keyGenerator !== null;
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-put
    put(value, key) {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      const prefix = "Failed to execute 'put' on 'IDBObjectStore'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      value = webidl.converters.any(value, {
        prefix,
        context: "Argument 1",
      });
      key = webidl.converters.any(key, {
        prefix,
        context: "Argument 2",
      });

      return addOrPut(this, value, key, false);
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-add
    add(value, key) {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      const prefix = "Failed to execute 'add' on 'IDBObjectStore'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      value = webidl.converters.any(value, {
        prefix,
        context: "Argument 1",
      });
      key = webidl.converters.any(key, {
        prefix,
        context: "Argument 2",
      });

      return addOrPut(this, value, key, true);
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-delete
    delete(query) {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      const prefix = "Failed to execute 'delete' on 'IDBObjectStore'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      query = webidl.converters.any(query, {
        prefix,
        context: "Argument 1",
      });
      // TODO: 3.: source has been deleted
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      if (this[_transaction][_mode] === "readonly") {
        throw new DOMException("", "ReadOnlyError");
      }
      const range = valueToKeyRange(query, true);
      return asynchronouslyExecuteRequest(
        this,
        () => deleteRecordsFromObjectStore(this[_store], range),
      );
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-clear
    clear() {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      // TODO: 3.: source has been deleted
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      if (this[_transaction][_mode] === "readonly") {
        throw new DOMException("", "ReadOnlyError");
      }
      return asynchronouslyExecuteRequest(
        this,
        () => clearObjectStore(this[_store]),
      );
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-get
    get(query) {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      const prefix = "Failed to execute 'get' on 'IDBObjectStore'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      query = webidl.converters.any(query, {
        prefix,
        context: "Argument 1",
      });
      // TODO: 3.: source has been deleted
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      const range = valueToKeyRange(query, true);
      return asynchronouslyExecuteRequest(
        this,
        () => retrieveValueFromObjectStore(this[_store], range),
      );
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-getkey
    getKey(query) {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      const prefix = "Failed to execute 'getKey' on 'IDBObjectStore'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      query = webidl.converters.any(query, {
        prefix,
        context: "Argument 1",
      });
      // TODO: 3.: source has been deleted
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      const range = valueToKeyRange(query, true);
      return asynchronouslyExecuteRequest(
        this,
        () => retrieveKeyFromObjectStore(this[_store], range),
      );
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-getall
    getAll(query, count = undefined) {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      const prefix = "Failed to execute 'getAll' on 'IDBObjectStore'";
      query = webidl.converters.any(query, {
        prefix,
        context: "Argument 1",
      });
      if (count !== undefined) {
        count = webidl.converters["unsigned long"](count, {
          prefix,
          context: "Argument 2",
          enforceRange: true,
        });
      }
      // TODO: 3.: source has been deleted
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      const range = valueToKeyRange(query, true);
      return asynchronouslyExecuteRequest(
        this,
        () => retrieveMultipleValuesFromObjectStore(this[_store], range, count),
      );
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-getallkeys
    getAllKeys(query, count = undefined) {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      const prefix = "Failed to execute 'getAllKeys' on 'IDBObjectStore'";
      query = webidl.converters.any(query, {
        prefix,
        context: "Argument 1",
      });
      if (count !== undefined) {
        count = webidl.converters["unsigned long"](count, {
          prefix,
          context: "Argument 2",
          enforceRange: true,
        });
      }
      // TODO: 3.: source has been deleted
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      const range = valueToKeyRange(query, true);
      return asynchronouslyExecuteRequest(
        this,
        () => retrieveMultipleKeysFromObjectStore(this[_store], range, count),
      );
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-count
    count(query) {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      const prefix = "Failed to execute 'count' on 'IDBObjectStore'";
      query = webidl.converters.any(query, {
        prefix,
        context: "Argument 1",
      });
      // TODO: 3.: source has been deleted
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      const range = valueToKeyRange(query, true);
      return asynchronouslyExecuteRequest(
        this,
        () => countRecordsInRange(this[_store], range),
      );
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-opencursor
    openCursor(query, direction = "next") {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      const prefix = "Failed to execute 'openCursor' on 'IDBObjectStore'";
      query = webidl.converters.any(query, {
        prefix,
        context: "Argument 1",
      });
      direction = webidl.converters.IDBCursorDirection(direction, {
        prefix,
        context: "Argument 2",
      });
      // TODO: 3.: source has been deleted
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      const range = valueToKeyRange(query, true);
      const cursor = createCursor(
        this[_transaction],
        direction,
        this,
        range,
        false,
      );
      const request = asynchronouslyExecuteRequest(
        this,
        () => iterateCursor(cursor),
      );
      cursor[_request] = request;
      return request;
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-openkeycursor
    openKeyCursor(query, direction = "next") {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      const prefix = "Failed to execute 'openKeyCursor' on 'IDBObjectStore'";
      query = webidl.converters.any(query, {
        prefix,
        context: "Argument 1",
      });
      direction = webidl.converters.IDBCursorDirection(direction, {
        prefix,
        context: "Argument 2",
      });
      // TODO: 3.: source has been deleted
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      const range = valueToKeyRange(query, true);
      const cursor = createCursor(
        this[_transaction],
        direction,
        this,
        range,
        true,
      );
      const request = asynchronouslyExecuteRequest(
        this,
        () => iterateCursor(cursor),
      );
      cursor[_request] = request;
      return request;
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-index
    index(name) {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      const prefix = "Failed to execute 'index' on 'IDBObjectStore'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      name = webidl.converters.DOMString(name, {
        prefix,
        context: "Argument 1",
      });
      // TODO: 3.: source has been deleted
      if (this[_transaction][_state] === "finished") {
        throw new DOMException("", "InvalidStateError");
      }
      // TODO: 5., 6.: op? or cache?
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-createindex
    createIndex(name, keyPath, options = {}) {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      const prefix = "Failed to execute 'createIndex' on 'IDBObjectStore'";
      webidl.requiredArguments(arguments.length, 2, { prefix });
      name = webidl.converters.DOMString(name, {
        prefix,
        context: "Argument 1",
      });
      keyPath = webidl.converters["sequence<DOMString> or DOMString"](keyPath, {
        prefix,
        context: "Argument 2",
      });
      options = webidl.converters.IDBIndexParameters(options, {
        prefix,
        context: "Argument 3",
      });
      if (this[_transaction][_mode] !== "versionchange") {
        throw new DOMException("", "InvalidStateError");
      }
      // TODO: 4.: source has been deleted
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      // TODO: 6.: op? or cache?
      if (!isValidKeyPath(keyPath)) {
        throw new DOMException("", "SyntaxError");
      }
      if (ArrayIsArray(keyPath) && options.multiEntry) {
        throw new DOMException("", "InvalidAccessError");
      }
      // TODO: 11.: ops
      // TODO: 12.: seems we need a cache?
      const index = new Index();
      index.name = name;
      index.multiEntry = options.multiEntry;
      index.unique = options.unique;
      const indexHandle = webidl.createBranded(IDBIndex);
      indexHandle[_index] = index;
      indexHandle[_storeHandle] = this;
      return indexHandle;
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbobjectstore-deleteindex
    deleteIndex(name) {
      webidl.assertBranded(this, IDBObjectStorePrototype);
      const prefix = "Failed to execute 'deleteIndex' on 'IDBObjectStore'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      name = webidl.converters.DOMString(name, {
        prefix,
        context: "Argument 1",
      });
      if (this[_transaction][_mode] !== "versionchange") {
        throw new DOMException("", "InvalidStateError");
      }
      // TODO: 4.: source has been deleted
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      // TODO: 6., 7., 8.: op?
    }
  }
  webidl.configurePrototype(IDBObjectStore);
  const IDBObjectStorePrototype = IDBObjectStore.prototype;

  // Ref: https://w3c.github.io/IndexedDB/#retrieve-a-referenced-value-from-an-index
  function retrieveReferencedValueFromIndex(index, range) {
    const val = core.opSync(
      "op_indexeddb_index_retrieve_value",
      // TODO: args (index needs to be structured properly)
    );
    if (val === null) {
      return undefined;
    } else {
      return core.deserialize(val);
    }
  }

  // Ref: https://w3c.github.io/IndexedDB/#retrieve-multiple-referenced-values-from-an-index
  function retrieveMultipleReferencedValuesFromIndex(index, range, count) {
    const vals = core.opSync(
      "op_indexeddb_index_retrieve_multiple_values",
      // TODO: args (index needs to be structured properly)
    );
    return vals.map((val) => core.deserialize(val));
  }

  // Ref: https://w3c.github.io/IndexedDB/#retrieve-a-value-from-an-index
  function retrieveValueFromIndex(index, range) {
    const val = core.opSync(
      "op_indexeddb_index_retrieve_value",
      // TODO: args (index needs to be structured properly)
    );
    if (val === undefined) {
      return undefined;
    } else {
      return keyToValue(val);
    }
  }

  // Ref: https://w3c.github.io/IndexedDB/#retrieve-a-value-from-an-index
  function retrieveMultipleValuesFromIndex(index, range, count) {
    const vals = core.opSync(
      "op_indexeddb_index_retrieve_multiple_values",
      // TODO: args (index needs to be structured properly)
    );
    return vals.map((val) => keyToValue(val));
  }

  class Index {
    /** @type {string} */
    name;
    /** @type {boolean} */
    multiEntry;
    /** @type {boolean} */
    unique;
  }

  const _index = Symbol("[[_index]]");
  const _storeHandle = Symbol("[[storeHandle]]");
  // Ref: https://w3c.github.io/IndexedDB/#idbindex
  class IDBIndex {
    constructor() {
      webidl.illegalConstructor();
    }

    /** @type {Index} */
    [_index];
    /** @type {IDBObjectStore} */
    [_storeHandle];

    [_name];
    // Ref: https://w3c.github.io/IndexedDB/#dom-idbindex-name
    get name() {
      webidl.assertBranded(this, IDBIndexPrototype);
      return this[_name];
    }

    // Ref: https://w3c.github.io/IndexedDB/#ref-for-dom-idbindex-name%E2%91%A2
    set name(name) {
      webidl.assertBranded(this, IDBIndexPrototype);
      name = webidl.converters.DOMString(name, {
        prefix: "Failed to set 'name' on 'IDBIndex'",
        context: "Argument 1",
      });

      if (this[_transaction][_mode] !== "versionchange") {
        throw new DOMException("", "InvalidStateError");
      }

      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }

      // TODO: 6.: source has been deleted
      // TODO: 7.: should it be this's _name? or this's _index's name
      // TODO: 8.: op? or cache?

      this[_index].name = name;
      this[_name] = name;
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbindex-objectstore
    get objectStore() {
      webidl.assertBranded(this, IDBIndexPrototype);
      return this[_storeHandle];
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbindex-keypath
    get keyPath() {
      webidl.assertBranded(this, IDBIndexPrototype);
      return this[_storeHandle][_store].keyPath; // TODO: convert?
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbindex-multientry
    get multiEntry() {
      webidl.assertBranded(this, IDBIndexPrototype);
      return this[_index].multiEntry;
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbindex-unique
    get unique() {
      webidl.assertBranded(this, IDBIndexPrototype);
      return this[_index].unique;
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbindex-get
    get(query) {
      webidl.assertBranded(this, IDBIndexPrototype);
      const prefix = "Failed to execute 'get' on 'IDBIndex'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      query = webidl.converters.any(query, {
        prefix,
        context: "Argument 1",
      });
      // TODO: 3.: source has been deleted
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      const range = valueToKeyRange(query, true);
      return asynchronouslyExecuteRequest(
        this,
        () => retrieveReferencedValueFromIndex(this[_index], range),
      );
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbindex-getkey
    getKey(query) {
      webidl.assertBranded(this, IDBIndexPrototype);
      const prefix = "Failed to execute 'getKey' on 'IDBIndex'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      query = webidl.converters.any(query, {
        prefix,
        context: "Argument 1",
      });
      // TODO: 3.: source has been deleted
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      const range = valueToKeyRange(query, true);
      return asynchronouslyExecuteRequest(
        this,
        () => retrieveValueFromIndex(this[_index], range),
      );
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbindex-getall
    getAll(query, count = undefined) {
      webidl.assertBranded(this, IDBIndexPrototype);
      const prefix = "Failed to execute 'getAll' on 'IDBIndex'";
      query = webidl.converters.any(query, {
        prefix,
        context: "Argument 1",
      });
      if (count !== undefined) {
        count = webidl.converters["unsigned long"](count, {
          prefix,
          context: "Argument 2",
          enforceRange: true,
        });
      }
      // TODO: 3.: source has been deleted
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      const range = valueToKeyRange(query, true);
      return asynchronouslyExecuteRequest(
        this,
        () =>
          retrieveMultipleReferencedValuesFromIndex(this[_index], range, count),
      );
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbindex-getallkeys
    getAllKeys(query, count = undefined) {
      webidl.assertBranded(this, IDBIndexPrototype);
      const prefix = "Failed to execute 'getAllKeys' on 'IDBIndex'";
      query = webidl.converters.any(query, {
        prefix,
        context: "Argument 1",
      });
      if (count !== undefined) {
        count = webidl.converters["unsigned long"](count, {
          prefix,
          context: "Argument 2",
          enforceRange: true,
        });
      }
      // TODO: 3.: source has been deleted
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      const range = valueToKeyRange(query, true);
      return asynchronouslyExecuteRequest(
        this,
        () => retrieveMultipleValuesFromIndex(this[_index], range, count),
      );
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbindex-count
    count(query) {
      webidl.assertBranded(this, IDBIndexPrototype);
      const prefix = "Failed to execute 'count' on 'IDBIndex'";
      query = webidl.converters.any(query, {
        prefix,
        context: "Argument 1",
      });
      // TODO: 3.: source has been deleted
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      const range = valueToKeyRange(query, true);
      return asynchronouslyExecuteRequest(
        this,
        () => countRecordsInRange(this[_index], range),
      );
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbindex-opencursor
    openCursor(query, direction = "next") {
      webidl.assertBranded(this, IDBIndexPrototype);
      const prefix = "Failed to execute 'openCursor' on 'IDBIndex'";
      query = webidl.converters.any(query, {
        prefix,
        context: "Argument 1",
      });
      direction = webidl.converters.IDBCursorDirection(direction, {
        prefix,
        context: "Argument 2",
      });
      // TODO: 3.: source has been deleted
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      const range = valueToKeyRange(query, true);
      const cursor = createCursor(
        this[_transaction],
        direction,
        this,
        range,
        false,
      );
      const request = asynchronouslyExecuteRequest(
        this,
        () => iterateCursor(cursor),
      );
      cursor[_request] = request;
      return request;
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbindex-openkeycursor
    openKeyCursor(query, direction = "next") {
      webidl.assertBranded(this, IDBIndexPrototype);
      const prefix = "Failed to execute 'openKeyCursor' on 'IDBIndex'";
      query = webidl.converters.any(query, {
        prefix,
        context: "Argument 1",
      });
      direction = webidl.converters.IDBCursorDirection(direction, {
        prefix,
        context: "Argument 2",
      });
      // TODO: 3.: source has been deleted
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      const range = valueToKeyRange(query, true);
      const cursor = createCursor(
        this[_transaction],
        direction,
        this,
        range,
        true,
      );
      const request = asynchronouslyExecuteRequest(
        this,
        () => iterateCursor(cursor),
      );
      cursor[_request] = request;
      return request;
    }
  }
  webidl.configurePrototype(IDBIndex);
  const IDBIndexPrototype = IDBIndex.prototype;

  const _lowerBound = Symbol("[[lowerBound]]");
  const _upperBound = Symbol("[[upperBound]]");
  const _lowerOpen = Symbol("[[lowerOpen]]");
  const _upperOpen = Symbol("[[upperOpen]]");

  function createRange(
    lowerBound,
    upperBound,
    lowerOpen = false,
    upperOpen = false,
  ) {
    const range = webidl.createBranded(IDBKeyRange);
    range[_lowerBound] = lowerBound;
    range[_upperBound] = upperBound;
    range[_lowerOpen] = lowerOpen;
    range[_upperOpen] = upperOpen;
    return range;
  }

  /**
   * @param range {IDBKeyRange}
   * @param key {any}
   * @returns {boolean}
   */
  // Ref: https://w3c.github.io/IndexedDB/#in
  function keyInRange(range, key) {
    const lower = range[_lowerBound] === null ||
      compareTwoKeys(range[_lowerBound], key) === -1 ||
      (compareTwoKeys(range[_lowerBound], key) === 0 && !range[_lowerOpen]);
    const upper = range[_upperBound] === null ||
      compareTwoKeys(range[_upperBound], key) === 1 ||
      (compareTwoKeys(range[_upperBound], key) === 0 && !range[_upperOpen]);
    return lower && upper;
  }

  // Ref: https://w3c.github.io/IndexedDB/#idbkeyrange
  class IDBKeyRange {
    constructor() {
      webidl.illegalConstructor();
    }

    [_lowerBound];
    // Ref: https://w3c.github.io/IndexedDB/#dom-idbkeyrange-lower
    get lower() {
      webidl.assertBranded(this, IDBKeyRangePrototype);
      return this[_lowerBound];
    }

    [_upperBound];
    // Ref: https://w3c.github.io/IndexedDB/#dom-idbkeyrange-upper
    get upper() {
      webidl.assertBranded(this, IDBKeyRangePrototype);
      return this[_upperBound];
    }

    [_lowerOpen];
    // Ref: https://w3c.github.io/IndexedDB/#dom-idbkeyrange-loweropen
    get lowerOpen() {
      webidl.assertBranded(this, IDBKeyRangePrototype);
      return this[_lowerOpen];
    }

    [_upperOpen];
    // Ref: https://w3c.github.io/IndexedDB/#dom-idbkeyrange-upperopen
    get upperOpen() {
      webidl.assertBranded(this, IDBKeyRangePrototype);
      return this[_upperOpen];
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbkeyrange-only
    static only(value) {
      const prefix = "Failed to execute 'only' on 'IDBKeyRange'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      value = webidl.converters.any(value, {
        prefix,
        context: "Argument 1",
      });
      const key = valueToKey(value);
      if (key === null) {
        throw new DOMException("Invalid key provided", "DataError");
      }
      return createRange(key, key);
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbkeyrange-lowerbound
    static lowerBound(lower, open = false) {
      const prefix = "Failed to execute 'lowerBound' on 'IDBKeyRange'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      lower = webidl.converters.any(lower, {
        prefix,
        context: "Argument 1",
      });
      open = webidl.converters.boolean(open, {
        prefix,
        context: "Argument 2",
      });
      const lowerKey = valueToKey(lower);
      if (lowerKey === null) {
        throw new DOMException("Invalid key provided", "DataError");
      }
      return createRange(lowerKey, null, open, true);
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbkeyrange-upperbound
    static upperBound(upper, open = false) {
      const prefix = "Failed to execute 'upperBound' on 'IDBKeyRange'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      upper = webidl.converters.any(upper, {
        prefix,
        context: "Argument 1",
      });
      open = webidl.converters.boolean(open, {
        prefix,
        context: "Argument 2",
      });
      const upperKey = valueToKey(upper);
      if (upperKey === null) {
        throw new DOMException("Invalid key provided", "DataError");
      }
      return createRange(null, upperKey, true, open);
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbkeyrange-bound
    static bound(lower, upper, lowerOpen = false, upperOpen = false) {
      const prefix = "Failed to execute 'bound' on 'IDBKeyRange'";
      webidl.requiredArguments(arguments.length, 2, { prefix });
      lower = webidl.converters.any(lower, {
        prefix,
        context: "Argument 1",
      });
      upper = webidl.converters.any(upper, {
        prefix,
        context: "Argument 2",
      });
      lowerOpen = webidl.converters.boolean(lowerOpen, {
        prefix,
        context: "Argument 3",
      });
      upperOpen = webidl.converters.boolean(upperOpen, {
        prefix,
        context: "Argument 4",
      });
      const lowerKey = valueToKey(lower);
      if (lowerKey === null) {
        throw new DOMException("Invalid lower key provided", "DataError");
      }
      const upperKey = valueToKey(upper);
      if (upperKey === null) {
        throw new DOMException("Invalid upper key provided", "DataError");
      }
      if (compareTwoKeys(lowerKey, upperKey) === 1) {
        throw new DOMException(
          "Lower key is greater than upper key",
          "DataError",
        );
      }
      return createRange(lowerKey, upperKey, lowerOpen, upperOpen);
    }

    includes(key) {
      webidl.assertBranded(this, IDBKeyRangePrototype);
      const prefix = "Failed to execute 'includes' on 'IDBKeyRange'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      key = webidl.converters.any(key, {
        prefix,
        context: "Argument 1",
      });
      const keyVal = valueToKey(key);
      if (keyVal === null) {
        throw new DOMException("Invalid key provided", "DataError");
      }
      return keyInRange(this, key);
    }
  }
  webidl.configurePrototype(IDBKeyRange);
  const IDBKeyRangePrototype = IDBKeyRange.prototype;

  function createCursor(transaction, direction, source, range, keyOnly) {
    const cursor = webidl.createBranded(IDBCursor);
    cursor[_transaction] = transaction;
    cursor[_position] = undefined;
    cursor[_direction] = direction;
    cursor[_gotValue] = false;
    cursor[_key] = undefined;
    cursor[_value] = undefined;
    cursor[_source] = source;
    cursor[_range] = range;
    cursor[_keyOnly] = keyOnly;
    return cursor;
  }

  const _direction = Symbol("[[direction]]");
  const _position = Symbol("[[position]]");
  const _gotValue = Symbol("[[gotValue]]");
  const _key = Symbol("[[key]]");
  const _value = Symbol("[[value]]");
  const _range = Symbol("[[range]]");
  const _keyOnly = Symbol("[[keyOnly]]");
  const _effectiveKey = Symbol("[[effectiveKey]]");
  const _effectiveObjectStore = Symbol("[[effectiveObjectStore]]");
  const _objectStorePosition = Symbol("[[objectStorePosition]]");
  const _request = Symbol("[[request]]");
  // Ref: https://w3c.github.io/IndexedDB/#idbcursor
  class IDBCursor {
    constructor() {
      webidl.illegalConstructor();
    }

    /** @type {IDBTransaction} */
    [_transaction];

    [_position];
    [_gotValue];
    [_value];
    [_range];
    [_keyOnly];
    [_objectStorePosition];
    get [_effectiveObjectStore]() {
      if (this[_source] instanceof IDBObjectStore) {
        return this[_position];
      } else if (this[_source] instanceof IDBIndex) {
        return this[_objectStorePosition];
      }
    }
    get [_effectiveKey]() {
      if (this[_source] instanceof IDBObjectStore) {
        return this[_position];
      } else if (this[_source] instanceof IDBIndex) {
        return this[_objectStorePosition];
      }
    }

    [_source];
    // Ref: https://w3c.github.io/IndexedDB/#dom-idbcursor-source
    get source() {
      webidl.assertBranded(this, IDBCursorPrototype);
      return this[_source];
    }

    /** @type {IDBCursorDirection} */
    [_direction];
    // Ref: https://w3c.github.io/IndexedDB/#dom-idbcursor-direction
    get direction() {
      webidl.assertBranded(this, IDBCursorPrototype);
      return this[_direction];
    }

    [_key];
    // Ref: https://w3c.github.io/IndexedDB/#dom-idbcursor-key
    get key() {
      webidl.assertBranded(this, IDBCursorPrototype);
      return keyToValue(this[_key]);
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbcursor-primarykey
    get primaryKey() {
      webidl.assertBranded(this, IDBCursorPrototype);
      return keyToValue(this[_effectiveKey]);
    }

    [_request];
    // Ref: https://w3c.github.io/IndexedDB/#dom-idbcursor-request
    get request() {
      webidl.assertBranded(this, IDBCursorPrototype);
      return this[_request];
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbcursor-advance
    advance(count) {
      webidl.assertBranded(this, IDBCursorPrototype);
      const prefix = "Failed to execute 'advance' on 'IDBCursor'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      count = webidl.converters["unsigned long"](count, {
        prefix,
        context: "Argument 1",
        enforceRange: true,
      });
      if (count === 0) {
        throw new TypeError("Count cannot be 0");
      }
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      // TODO: 4.: source has been deleted
      if (!this[_gotValue]) {
        throw new DOMException("", "InvalidStateError");
      }
      this[_gotValue] = false;
      this[_request][_processed] = false;
      this[_request][_done] = false;

      return asynchronouslyExecuteRequest(
        this,
        () => iterateCursor(this, count),
        this[_request],
      );
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbcursor-continue
    continue(key) {
      webidl.assertBranded(this, IDBCursorPrototype);
      const prefix = "Failed to execute 'key' on 'IDBCursor'";
      key = webidl.converters.any(key, {
        prefix,
        context: "Argument 1",
      });
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      // TODO: 4.: source has been deleted
      if (key !== undefined) {
        key = valueToKey(key);
        if (key === null) {
          throw new DOMException("", "DataError");
        }
        if (
          (compareTwoKeys(key, this[_position]) !== 1) &&
          (this[_direction] === "next" || this[_direction] === "nextunique")
        ) {
          throw new DOMException("", "DataError");
        }
        if (
          (compareTwoKeys(key, this[_position]) !== -1) &&
          (this[_direction] === "prev" || this[_direction] === "prevunique")
        ) {
          throw new DOMException("", "DataError");
        }
      }
      this[_gotValue] = false;
      this[_request][_processed] = false;
      this[_request][_done] = false;

      return asynchronouslyExecuteRequest(
        this,
        () => iterateCursor(this, key),
        this[_request],
      );
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbcursor-continueprimarykey
    continuePrimaryKey(key, primaryKey) {
      webidl.assertBranded(this, IDBCursorPrototype);
      const prefix = "Failed to execute 'continuePrimaryKey' on 'IDBCursor'";
      webidl.requiredArguments(arguments.length, 2, { prefix });
      key = webidl.converters.any(key, {
        prefix,
        context: "Argument 1",
      });
      primaryKey = webidl.converters.any(primaryKey, {
        prefix,
        context: "Argument 2",
      });
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      // TODO: 3.: source has been deleted
      if (!(this[_source] instanceof IDBIndex)) {
        throw new DOMException("", "InvalidAccessError");
      }
      if (this[_direction] !== "next" && this[_direction] !== "prev") {
        throw new DOMException("", "InvalidAccessError");
      }
      if (!this[_gotValue]) {
        throw new DOMException("", "InvalidAccessError");
      }
      key = valueToKey(key);
      if (key === null) {
        throw new DOMException("", "DataError");
      }
      primaryKey = valueToKey(primaryKey);
      if (primaryKey === null) {
        throw new DOMException("", "DataError");
      }
      if (
        compareTwoKeys(key, this[_direction]) === -1 &&
        this[_direction] === "next"
      ) {
        throw new DOMException("", "DataError");
      }
      if (
        compareTwoKeys(key, this[_direction]) === 1 &&
        this[_direction] === "prev"
      ) {
        throw new DOMException("", "DataError");
      }
      if (
        compareTwoKeys(key, this[_direction]) === 0 &&
        compareTwoKeys(primaryKey, this[_objectStorePosition]) !== 1 &&
        this[_direction] === "next"
      ) {
        throw new DOMException("", "DataError");
      }
      if (
        compareTwoKeys(key, this[_direction]) === 0 &&
        compareTwoKeys(primaryKey, this[_objectStorePosition]) !== -1 &&
        this[_direction] === "prev"
      ) {
        throw new DOMException("", "DataError");
      }
      this[_gotValue] = false;
      this[_request][_processed] = false;
      this[_request][_done] = false;

      return asynchronouslyExecuteRequest(
        this,
        () => iterateCursor(this, key, primaryKey),
        this[_request],
      );
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbcursor-update
    update(value) {
      webidl.assertBranded(this, IDBCursorPrototype);
      const prefix = "Failed to execute 'update' on 'IDBCursor'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      value = webidl.converters.any(value, {
        prefix,
        context: "Argument 1",
      });
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      if (this[_transaction][_mode] === "readonly") {
        throw new DOMException("", "ReadOnlyError");
      }
      // TODO: 4.: source has been deleted
      if (!this[_gotValue]) {
        throw new DOMException("", "InvalidStateError");
      }
      if (this[_keyOnly]) {
        throw new DOMException("", "InvalidStateError");
      }
      const cloned = clone(value); // TODO: during transaction?
      if (this[_effectiveObjectStore][_store].keyPath !== null) {
        const kpk = extractKeyFromValueUsingKeyPath(
          cloned,
          this[_effectiveObjectStore][_store].keyPath,
        );
        if (kpk === null || kpk === _failure || kpk !== this[_effectiveKey]) {
          throw new DOMException("", "DataError");
        }
      }

      return asynchronouslyExecuteRequest(
        this,
        () =>
          storeRecordIntoObjectStore(
            this[_effectiveObjectStore],
            cloned,
            this[_effectiveKey],
            false,
          ),
      );
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbcursor-delete
    delete() {
      webidl.assertBranded(this, IDBCursorPrototype);
      if (this[_transaction][_state] !== "active") {
        throw new DOMException("", "TransactionInactiveError");
      }
      if (this[_transaction][_mode] === "readonly") {
        throw new DOMException("", "ReadOnlyError");
      }
      // TODO: 4.: source has been deleted
      if (!this[_gotValue]) {
        throw new DOMException("", "InvalidStateError");
      }
      if (this[_keyOnly]) {
        throw new DOMException("", "InvalidStateError");
      }

      return asynchronouslyExecuteRequest(
        this,
        () =>
          deleteRecordsFromObjectStore(
            this[_effectiveObjectStore],
            this[_effectiveKey],
          ),
      );
    }
  }
  webidl.configurePrototype(IDBCursor);
  const IDBCursorPrototype = IDBCursor.prototype;

  const _requestList = Symbol("[[requestList]]");
  const _state = Symbol("[[state]]");
  const _mode = Symbol("[[mode]]");
  const _durabilityHint = Symbol("[[durabilityHint]]");
  const _db = Symbol("[[db]]");
  // Ref: https://w3c.github.io/IndexedDB/#idbtransaction
  class IDBTransaction extends EventTarget {
    [_requestList] = [];
    /** @type {TransactionState} */
    [_state] = "active";
    [_mode];
    [_durabilityHint];
    [_error];
    [_db];

    constructor() {
      super();
      webidl.illegalConstructor();
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbtransaction-objectstorenames
    get objectStoreNames() {
      webidl.assertBranded(this, IDBTransactionPrototype);
      // TODO: from _db and cache? or op?
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbtransaction-mode
    get mode() {
      webidl.assertBranded(this, IDBTransactionPrototype);
      return this[_mode];
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbtransaction-durability
    get durability() {
      webidl.assertBranded(this, IDBTransactionPrototype);
      return this[_durabilityHint];
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbtransaction-db
    get db() {
      webidl.assertBranded(this, IDBTransactionPrototype);
      return this[_db];
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbtransaction-error
    get error() {
      webidl.assertBranded(this, IDBTransactionPrototype);
      return this[_error];
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbtransaction-objectstore
    objectStore(name) {
      webidl.assertBranded(this, IDBTransactionPrototype);
      const prefix = "Failed to execute 'objectStore' on 'IDBTransaction'";
      webidl.requiredArguments(arguments.length, 1, { prefix });
      name = webidl.converters.DOMString(name, {
        prefix,
        context: "Argument 1",
      });
      if (this[_state] === "finished") {
        throw new DOMException("", "InvalidStateError");
      }
      // TODO: 2., 3.: cache?
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbtransaction-commit
    commit() {
      webidl.assertBranded(this, IDBTransactionPrototype);
      if (this[_state] !== "active") {
        throw new DOMException("", "InvalidStateError");
      }
      return commitTransaction(this);
    }

    // Ref: https://w3c.github.io/IndexedDB/#dom-idbtransaction-abort
    abort() {
      webidl.assertBranded(this, IDBTransactionPrototype);
      if (this[_state] === "committing" || this[_state] === "finished") {
        throw new DOMException("", "InvalidStateError");
      }
      this[_state] = "inactive";
      abortTransaction(this, null);
    }
  }
  defineEventHandler(IDBTransaction.prototype, "abort");
  defineEventHandler(IDBTransaction.prototype, "complete");
  defineEventHandler(IDBTransaction.prototype, "error");

  webidl.configurePrototype(IDBTransaction);
  const IDBTransactionPrototype = IDBTransaction.prototype;

  window.__bootstrap.indexedDb = {
    indexeddb: webidl.createBranded(IDBFactory),
    IDBRequest,
    IDBOpenDBRequest,
    IDBFactory,
    IDBDatabase,
    IDBObjectStore,
    IDBIndex,
    IDBKeyRange,
    IDBCursor,
    IDBTransaction,
  };
})(this);
