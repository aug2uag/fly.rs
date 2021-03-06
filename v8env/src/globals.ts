// Copyright 2018 the Deno authors. All rights reserved. MIT license.

import { Console } from "./console";
import * as timers from "./timers";
// import * as textEncoding from "./text_encoding";
// import * as fetch_ from "./fetch";
import { libfly } from "./libfly";
import { globalEval } from "./global-eval";
import * as bridge from "./bridge";
import * as textEncoding from "./text-encoding";
import { FlyResponse } from "./response";
import * as fetch_ from './fetch';
import * as resolv_ from './resolv';
import * as dns from './dns';
import * as crypto_ from "./crypto";
import cache_ from "./cache";
import { Image } from "./fly/image";

import * as url from './url';
import { FlyRequest } from "./request";
import flyData from './fly/data';
import flyCache from './fly/cache';
import flyHttp from './fly/http'
import { loadModule } from "./module_loader";
import { installDevTools } from "./dev-tools";

declare global {
  interface Window {
    console: Console;
    define: Readonly<unknown>;
  }

  const clearTimeout: typeof timers.clearTimer;
  const clearInterval: typeof timers.clearTimer;
  const setTimeout: typeof timers.setTimeout;
  const setInterval: typeof timers.setInterval;

  const console: Console;
  const window: Window;

  const addEventListener: typeof bridge.addEventListener;

  const Response: typeof FlyResponse;
  const Request: typeof FlyRequest;

  const fetch: typeof fetch_.fetch;

  // tslint:disable:variable-name
  let TextEncoder: typeof textEncoding.TextEncoder;
  let TextDecoder: typeof textEncoding.TextDecoder;
  // tslint:enable:variable-name

  let URL: typeof url.URL;
  let URLSearchParams: typeof url.URLSearchParams;

  let crypto: typeof crypto_.crypto;
  let cache: typeof cache_;

  interface Fly {
    cache: typeof flyCache
    data: typeof flyData
    http: typeof flyHttp
    Image: typeof Image
  }
  // TODO: remove
  const fly: Fly

  const resolv: typeof resolv_.resolv;
  const DNSResponse: typeof dns.DNSResponse;
  const DNSRequest: typeof dns.DNSRequest;
  const DNSClass: typeof dns.DNSClass;
  const DNSRecordType: typeof dns.DNSRecordType;
  const DNSMessageType: typeof dns.DNSMessageType;
  const DNSOpCode: typeof dns.DNSOpCode;
  const DNSResponseCode: typeof dns.DNSResponseCode;
}

// A reference to the global object.
export const window = globalEval("this");
window.window = window;

window.libfly = null;

window.installDevTools = installDevTools;

window.setTimeout = timers.setTimeout;
window.clearTimeout = timers.clearTimer;
window.setInterval = timers.setInterval;
window.clearInterval = timers.clearTimer;
window.setImmediate = timers.setImmediate;
window.Response = FlyResponse;
window.Request = FlyRequest;

window.addEventListener = bridge.addEventListener;

window.console = new Console(libfly.print);
window.TextEncoder = textEncoding.TextEncoder;
window.TextDecoder = textEncoding.TextDecoder;
window.URL = url.URL;
window.URLSearchParams = url.URLSearchParams;

window.fetch = fetch_.fetch;
window.resolv = resolv_.resolv;
window.crypto = crypto_.crypto;
window.cache = cache_;
window.loadModule = loadModule;

window.fly = {
  cache: flyCache,
  data: flyData,
  http: flyHttp,
  Image: Image,
}

window.DNSRequest = dns.DNSRequest;
window.DNSResponse = dns.DNSResponse;
window.DNSClass = dns.DNSClass;
window.DNSRecordType = dns.DNSRecordType;
window.DNSMessageType = dns.DNSMessageType;
window.DNSOpCode = dns.DNSOpCode;
window.DNSResponseCode = dns.DNSResponseCode;
