// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
"use strict";

((window) => {
  const core = window.__bootstrap.core;
  const {
    TypeError,
  } = window.__bootstrap.primordials;
  const jupyter = {};

  function display(mimeType, buf, opt = {}) {
    // for known mime types, do the nice thing and select the known dataFormat
    let dataFormat = "base64";
    switch (mimeType) {
      case "text/plain":
      case "text/html":
        dataFormat = "string";
    }

    const args = {
      mimeType,
      dataFormat: opt.dataFormat ?? dataFormat,
      metadata: opt.metadata,
    };

    core.opSync("op_jupyter_display", args, buf);
  }

  function displayPng(buf, opt = {}) {
    display("image/png", buf, {
      metadata: {
        width: opt.width,
        height: opt.height,
      },
    });
  }

  async function displayPngFile(path, opt = {}) {
    const buf = await Deno.readFile(path);
    displayPng(buf, opt);
  }

  function displayHtml(str) {
    display("text/html", new TextEncoder().encode(str), {
      dataFormat: "string",
    });
  }

  async function displayHtmlFile(path) {
    const buf = await Deno.readFile(path);
    display("text/html", buf, {
      dataFormat: "string",
    });
  }

  function displayVegaLite(spec) {
    if (typeof spec === "object") {
      spec = JSON.stringify(spec);
    }

    display("application/vnd.vegalite.v3+json", new TextEncoder().encode(spec), { dataFormat: "json" });
  } 

  async function displayVegaLiteFile(path) {
    const buf = await Deno.readFile(path);
    display("application/vnd.vegalite.v3+json", buf, { dataFormat: "json" });
  } 

  // from: https://jupyterlab.readthedocs.io/en/stable/user/file_formats.html
  // application/json
  // text/markdown
  // image/bmp
  // image/gif
  // image/jpeg
  // image/svg+xml
  // text/html
  // text/latex
  // application/pdf
  // application/vnd.vega.v5+json
  // application/vdom.v1+json

  function displayFile(path, opt = {}) {
    let fileType;
    if (opt.hint) {
      fileType = opt.hint;
    } else {
      const pathParts = path.split(".");
      fileType = pathParts[pathParts.length - 1];
    }
    fileType = fileType.toLowerCase();

    switch (fileType) {
      case "png": return displayPngFile(path, opt);
      case "html": return displayHtmlFile(path);
      case "vl": return displayVegaLiteFile(path);
      default: throw new TypeError(`unknown file type: ${fileType}`)
    }
  }

  jupyter.display = display;
  jupyter.displayPng = displayPng;
  jupyter.displayPngFile = displayPngFile;
  jupyter.displayHtml = displayHtml;
  jupyter.displayHtmlFile = displayHtmlFile;
  jupyter.displayVegaLite = displayVegaLite;
  jupyter.displayVegaLiteFile = displayVegaLiteFile;
  jupyter.displayFile = displayFile;
  window.__bootstrap.jupyter = jupyter;
})(this);
