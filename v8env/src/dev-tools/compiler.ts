import * as ts from "typescript"

import { assert } from "./util"
import { fetchModule } from "./resolver";
import { extname } from "./path";
import { ContainerName } from "./assets";

const EOL = "\n";

type AmdCallback = (...args: unknown[]) => void;
type AmdErrback = (err: unknown) => void;
export type AmdFactory = (...args: unknown[]) => object | void;
export type AmdDefine = (deps: ModuleSpecifier[], factory: AmdFactory) => void;
type AMDRequire = (deps: ModuleSpecifier[], callback: AmdCallback, errback: AmdErrback) => void;

/**
 * The location that a module is being loaded from. This could be a directory,
 * like `.`, or it could be a module specifier like
 * `http://gist.github.com/somefile.ts`
 */
type ContainingFile = string;
/**
 * The internal local filename of a compiled module. It will often be something
 * like `/home/ry/.deno/gen/f7b4605dfbc4d3bb356e98fda6ceb1481e4a8df5.js`
 */
type ModuleFileName = string;
/**
 * The original resolved resource name.
 * Path to cached module file or URL from which dependency was retrieved
 */
type ModuleId = string;
/**
 * The external name of a module - could be a URL or could be a relative path.
 * Examples `http://gist.github.com/somefile.ts` or `./somefile.ts`
 */
type ModuleSpecifier = string;
/**
 * The compiled source code which is cached in `.deno/gen/`
 */
type OutputCode = string;
/**
 * The original source code
 */
type SourceCode = string;

declare type ImportSpecifier = [ModuleSpecifier, ContainingFile];

enum MediaType {
  JavaScript = 0,
  TypeScript,
  Json,
  Unknown
}

class ModuleInfo implements ts.IScriptSnapshot {
  public readonly moduleId: ModuleId;
  public readonly fileName: ModuleFileName;
  public version: number = 1;
  public inputCode: SourceCode = "";
  public outputCode?: OutputCode;
  public exports = {};
  public hasRun: boolean = false;
  public factory?: AmdFactory;
  public gatheringDeps = false;
  public deps?: ModuleId[];
  public readonly mediaType: MediaType;

  public constructor(moduleId: ModuleId, fileName: ModuleFileName, version?: number, type?: MediaType)
  {
    this.moduleId = moduleId;
    this.fileName = fileName;
    this.version = version || 1;
    this.mediaType = type;
  }

  reload() {
    this.hasRun = false;
    this.exports = {}
    this.factory = undefined;
    this.gatheringDeps = false;
    this.deps = undefined
    this.version += 1
    this.outputCode = undefined
  }

  getText(start: number, end: number): string {
    return this.inputCode.substring(start, end)
  }

  getLength(): number {
    return this.inputCode.length;
  }

  getChangeRange(oldSnapshot: ts.IScriptSnapshot): ts.TextChangeRange | undefined {
    return
  }
}

class ModuleCache {
  private readonly moduleIndex = new Map<string, ModuleInfo>();

  public get(fileName: ModuleFileName): ModuleInfo {
    const moduleInfo = this.moduleIndex.get(fileName);
    if (!moduleInfo) {
      throw new Error(`Module ${fileName} not found`)
    }
    return moduleInfo
  }

  public set(moduleInfo: ModuleInfo) {
    this.moduleIndex.set(moduleInfo.fileName, moduleInfo);
  }
  
  public has(fileName: ModuleFileName): boolean {
    return this.moduleIndex.has(fileName);
  }
}

export interface CompilerOptions {
  globalEval: (string) => any;
  global: any;
}

export class Compiler {
  private readonly moduleCache = new ModuleCache();
  private readonly fileNameCache = new Map<ImportSpecifier, ModuleFileName>();
  private readonly runQueue: ModuleInfo[] = [];
  public scriptFileNames: string[] = [];
  private readonly globalEval: (string) => any;
  private readonly global: any;
  private readonly languageService = createLanguageService(this);

  public constructor(options: CompilerOptions) {
    this.global = options.global;
    this.globalEval = options.globalEval;
  }

  public run(moduleSpecifier: ModuleSpecifier, containingFile: ContainingFile) {
    trace("run()", { moduleSpecifier, containingFile });
    const moduleMetaData = this.resolveModule(moduleSpecifier, containingFile);
    this.scriptFileNames = [moduleMetaData.fileName];
    if (!moduleMetaData.deps) {
      this.instantiateModule(moduleMetaData);
    }
    this.drainRunQueue();
    return moduleMetaData;
  }

  public resolveModule(moduleSpecifier: string, containingFile: string): ModuleInfo {
    trace("resolveModule()", { moduleSpecifier, containingFile })
    let fn = this.fileNameCache.get([moduleSpecifier, containingFile]);
    if (fn && this.moduleCache.has(fn)) {
      return this.moduleCache.get(fn);
    }
    let { moduleId, fileName, sourceCode } = fetchModule(moduleSpecifier, containingFile);

    if (!moduleId) {
      throw new Error(`Failed to resolve '${moduleSpecifier}' from '${containingFile}'`)
    }

    if (this.moduleCache.has(fileName)) {
      return this.moduleCache.get(fileName)
    }

    const moduleInfo = new ModuleInfo(moduleId, fileName, 0, mediaType(moduleId))
    moduleInfo.inputCode = sourceCode
    this.moduleCache.set(moduleInfo)
    this.fileNameCache.set([moduleSpecifier, containingFile], fileName);
    return moduleInfo
  }

  getModuleInfo(fileName: ModuleFileName): ModuleInfo {
    if (this.moduleCache.has(fileName)) {
      return this.moduleCache.get(fileName);
    }
    const moduleInfo = this.resolveModule(fileName, "")
    this.moduleCache.set(moduleInfo)
    return moduleInfo
  }

  /**
   * Retrieve the output of the TypeScript compiler for a given module and
   * cache the result. Re-compilation can be forced using '--recompile' flag.
   */
  compile(moduleInfo: ModuleInfo): OutputCode {
    const recompile = false; // only relevant for persistent cache
    if (!recompile && moduleInfo.outputCode) {
      return moduleInfo.outputCode;
    }
    const { fileName, inputCode, moduleId } = moduleInfo;
    const output = this.languageService.getEmitOutput(fileName);
    // Get the relevant diagnostics - this is 3x faster than
    // `getPreEmitDiagnostics`.
    const diagnostics = [
      ...this.languageService.getCompilerOptionsDiagnostics(),
      ...this.languageService.getSyntacticDiagnostics(fileName),
      ...this.languageService.getSemanticDiagnostics(fileName)
    ];
    if (diagnostics.length > 0) {
      const errMsg = ts.formatDiagnosticsWithColorAndContext(diagnostics, diagnosticHost);
      console.error("Compiler error", { errMsg });

      throw new Error("typescript error, quit")
      // this._os.exit(1);
    }

    assert(!output.emitSkipped, "The emit was skipped for an unknown reason.");

    // Currently we are inlining source maps, there should be only 1 output file
    // See: https://github.com/denoland/deno/issues/23
    assert(
      output.outputFiles.length === 1,
      "Only single file should be output."
    );

    const [outputFile] = output.outputFiles;
    const outputCode = (moduleInfo.outputCode = `${
      outputFile.text
      }\n//# sourceURL=${fileName}`);
    moduleInfo.version = 1;
    // write to persistent cache
    // this._os.codeCache(fileName, sourceCode, outputCode);
    return moduleInfo.outputCode;
  }

  public transform(moduleId: string): string {
    trace("transform()", { moduleId });
    const moduleMetaData = this.resolveModule(moduleId, "");
    this.scriptFileNames = [moduleId];
    return this.compile(moduleMetaData)
  }

  /**
   * Drain the run queue, retrieving the arguments for the module
   * factory and calling the module's factory.
   */
  drainRunQueue(): void {
    trace(
      "drainRunQueue()",
      this.runQueue.map(moduleInfo => moduleInfo.moduleId)
    );
    let moduleMetaData: ModuleInfo | undefined;
    while ((moduleMetaData = this.runQueue.shift())) {
      assert(
        moduleMetaData.factory != null,
        "Cannot run module without factory."
      );
      assert(moduleMetaData.hasRun === false, "Module has already been run.");
      // asserts not tracked by TypeScripts, so using not null operator
      moduleMetaData.factory!(...this.getFactoryArguments(moduleMetaData));
      moduleMetaData.hasRun = true;
    }
  }

  /**
   * Get the dependencies for a given module, but don't run the module,
   * just add the module factory to the run queue.
   */
  instantiateModule(moduleInfo: ModuleInfo): void {
    trace("instantiateModule()", moduleInfo.moduleId);

    // if the module has already run, we can short circuit.
    // it is intentional though that if we have already resolved dependencies,
    // we won't short circuit, as something may have changed, or we might have
    // only collected the dependencies to be able to able to obtain the graph of
    // dependencies
    if (moduleInfo.hasRun) {
      return;
    }

    this.global.define = this.makeDefine(moduleInfo);
    this.globalEval(this.compile(moduleInfo));
    this.global.define = undefined;
  }

  /**
   * Retrieve the arguments to pass a module's factory function.
   */
  getFactoryArguments(moduleMetaData: ModuleInfo): any[] {
    // return []
    if (!moduleMetaData.deps) {
      throw new Error("Cannot get arguments until dependencies resolved.");
    }
    return moduleMetaData.deps.map(dep => {
      if (dep === "require") {
        return this.makeLocalRequire(moduleMetaData);
      }
      if (dep === "exports") {
        return moduleMetaData.exports;
      }
      // if (dep in DenoCompiler._builtins) {
      //   return DenoCompiler._builtins[dep];
      // }
      const dependencyMetaData = this.getModuleInfo(dep);
      assert(dependencyMetaData != null, `Missing dependency "${dep}".`);
      // TypeScript does not track assert, therefore using not null operator
      return dependencyMetaData!.exports;
    });
  }

  /**
   * Create a localized AMD `define` function and return it.
   */
  makeDefine(moduleInfo: ModuleInfo): AmdDefine {
    return (deps: ModuleSpecifier[], factory: AmdFactory): void => {
      console.trace("compiler.localDefine", moduleInfo.fileName);
      moduleInfo.factory = factory;
      // when there are circular dependencies, we need to skip recursing the
      // dependencies
      moduleInfo.gatheringDeps = true;
      // we will recursively resolve the dependencies for any modules
      moduleInfo.deps = deps.map(dep => {
        if (
          dep === "require" ||
          dep === "exports" //||
          // dep in DenoCompiler._builtins
        ) {
          return dep;
        }
        const dependencyMetaData = this.resolveModule(dep, moduleInfo.fileName);
        if (!dependencyMetaData.gatheringDeps) {
          this.instantiateModule(dependencyMetaData);
        }
        return dependencyMetaData.fileName;
      });
      moduleInfo.gatheringDeps = false;
      if (!this.runQueue.includes(moduleInfo)) {
        this.runQueue.push(moduleInfo);
      }
    };
  }

  /**
   * Returns a require that specifically handles the resolution of a transpiled
   * emit of a dynamic ES `import()` from TypeScript.
   */
  makeLocalRequire(moduleInfo: ModuleInfo): AMDRequire {
    return (
      deps: ModuleSpecifier[],
      callback: AmdCallback,
      errback: AmdErrback
    ): void => {
      console.log("compiler.makeLocalRequire()", { moduleInfo, deps });
      assert(
        deps.length === 1,
        "Local require requires exactly one dependency."
      );
      const [moduleSpecifier] = deps;
      try {
        const requiredMetaData = this.run(moduleSpecifier, moduleInfo.fileName);
        callback(requiredMetaData.exports);
      } catch (e) {
        errback(e);
      }
    };
  }
}

const settings: ts.CompilerOptions = {
  allowJs: true,
  module: ts.ModuleKind.AMD,
  // module: ts.ModuleKind.ESNext,
  outDir: "$fly$",
  inlineSourceMap: true,
  inlineSources: true,
  stripComments: true,
  target: ts.ScriptTarget.ESNext
}

function createLanguageService(compiler: Compiler): ts.LanguageService {
  return ts.createLanguageService({
    getCompilationSettings(): ts.CompilerOptions {
      return settings;
    },
    getScriptFileNames(): string[] {
      return compiler.scriptFileNames;
    },
    getScriptVersion(fileName: string): string {
      trace("getScriptVersion()", { fileName })
      const moduleInfo = compiler.getModuleInfo(fileName);
      if (!moduleInfo) {
        return ""
      }
      return moduleInfo.version.toString();
    },
    getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
      trace("getScriptSnapshot()", { fileName })
      return compiler.getModuleInfo(fileName)
    },
    getCurrentDirectory(): string {
      return ""
    },
    getDefaultLibFileName(options: ts.CompilerOptions): string {
      trace("getDefaultLibFileName()");
      const moduleSpecifier = "lib.fly.runtime.d.ts";
      const moduleInfo = compiler.resolveModule(moduleSpecifier, ContainerName);
      return moduleInfo.fileName;
    },
    getNewLine: (): string => {
      return EOL;
    },
    log(s: string): void {
      console.log("[compilerHost]", s)
    },
    trace(s: string): void {
      console.trace("[compilerHost]", s)
    },
    error(s: string): void {
      console.error("[compilerHost]", s)
    },
    resolveModuleNames(moduleNames: string[], containingFile: string, reusedNames?: string[]): ts.ResolvedModule[] {
      trace("resolveModuleNames()", { moduleNames, containingFile, reusedNames });

      return moduleNames.map(moduleName => {
        const moduleInfo = compiler.resolveModule(moduleName, containingFile)
        // an empty string will cause typescript to bomb, maybe fail here instead?
        const resolvedFileName = moduleInfo && moduleInfo.moduleId || ""
        const isExternal = false; // need cwd/cjs logic for this maybe?
        return { resolvedFileName, isExternal }
      })
    },
    getScriptKind(fileName: string): ts.ScriptKind {
      trace("getScriptKind()", { fileName });
      const moduleMetaData = compiler.getModuleInfo(fileName);
      if (moduleMetaData) {
        switch (moduleMetaData.mediaType) {
          case MediaType.TypeScript:
            return ts.ScriptKind.TS;
          case MediaType.JavaScript:
            return ts.ScriptKind.JS;
          case MediaType.Json:
            return ts.ScriptKind.JSON;
          default:
            return settings.allowJs ? ts.ScriptKind.JS : ts.ScriptKind.TS;
        }
      } else {
        return settings.allowJs ? ts.ScriptKind.JS : ts.ScriptKind.TS;
      }
    },
    useCaseSensitiveFileNames(): boolean {
      return true;
    },
    fileExists(path: string): boolean {
      const info = compiler.getModuleInfo(path);
      const exists = info != null;
      trace("fileExists()", { path, exists });
      return exists;
    },
  })
}

const diagnosticHost: ts.FormatDiagnosticsHost = {
  getNewLine: () => EOL,
  getCurrentDirectory: () => "",
  getCanonicalFileName: (path) => path
}

// TODO: move this to resolver?
function mediaType(moduleId): MediaType {
  switch (extname(moduleId)) {
    case ".ts": return MediaType.TypeScript;
    case ".js": return MediaType.JavaScript;
    case ".json": return MediaType.Json;
  }
  return MediaType.Unknown;
}

function trace(...args: any[]) {
  console.trace("[compiler]", ...args);
}