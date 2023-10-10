import * as ts from "../../_namespaces/ts";
import {
    baselineTsserverLogs,
    createLoggerWithInMemoryLogs,
    createProjectService,
    createSession,
    openFilesForSession,
    toExternalFile,
} from "../helpers/tsserver";
import {
    FileWithTypingPackageName,
    TestTypingsInstaller,
} from "../helpers/typingsInstaller";
import {
    createServerHost,
} from "../helpers/virtualFileSystemWithWatch";

describe("unittests:: tsserver:: typeAquisition:: autoDiscovery", () => {
    it("does not depend on extension", () => {
        const file1 = {
            path: "/a/b/app.html",
            content: "",
        };
        const file2 = {
            path: "/a/b/app.d.ts",
            content: "",
        };
        const host = createServerHost([file1, file2]);
        const projectService = createProjectService(host, { logger: createLoggerWithInMemoryLogs(host) });
        projectService.openExternalProject({
            projectFileName: "/a/b/proj.csproj",
            rootFiles: [toExternalFile(file2.path), { fileName: file1.path, hasMixedContent: true, scriptKind: ts.ScriptKind.JS }],
            options: {},
        });
        const typeAcquisition = projectService.externalProjects[0].getTypeAcquisition();
        projectService.logger.log(`Typine acquisition should be enabled: ${typeAcquisition.enable}`);
        baselineTsserverLogs("typeAquisition", "does not depend on extension", projectService);
    });
});

describe("unittests:: tsserver:: typeAquisition:: prefer typings to js", () => {
    it("during second resolution pass", () => {
        const globalTypingsCacheLocation = "/a/typings";
        const f1 = {
            path: "/a/b/app.js",
            content: "var x = require('bar')",
        };
        const barjs = {
            path: "/a/b/node_modules/bar/index.js",
            content: "export let x = 1",
        };
        const barTypings = {
            path: `${globalTypingsCacheLocation}/node_modules/@types/bar/index.d.ts`,
            content: "export let y: number",
        };
        const config = {
            path: "/a/b/jsconfig.json",
            content: JSON.stringify({ compilerOptions: { allowJs: true }, exclude: ["node_modules"] }),
        };
        const host = createServerHost([f1, barjs, barTypings, config]);
        const logger = createLoggerWithInMemoryLogs(host);
        const projectService = createProjectService(host, {
            typingsInstaller: new TestTypingsInstaller(host, logger, { globalTypingsCacheLocation }),
            logger,
        });

        projectService.openClientFile(f1.path);

        baselineTsserverLogs("typeAquisition", "prefer typings in second pass", projectService);
    });
});

describe("unittests:: tsserver:: typeAquisition:: changes", () => {
    it("changes to typeAquisition with already aquired typing", () => {
        const { host, session, disableTypeAcquisition, verifyEnabledTypeAcquisition } = setup(
            /*hostHasBarTyping*/ true,
            /*enablebleTypeAquisition*/ true,
        );
        disableTypeAcquisition();
        host.runQueuedTimeoutCallbacks();
        verifyEnabledTypeAcquisition();
        baselineTsserverLogs("typeAquisition", "changes to typeAquisition with already aquired typing", session);
    });

    it("changes to typeAquisition when typing installer installs typing", () => {
        const { host, typingsInstaller, session, disableTypeAcquisition, verifyEnabledTypeAcquisition } = setup(
            /*hostHasBarTyping*/ false,
            /*enablebleTypeAquisition*/ true,
        );
        typingsInstaller.installer.executePendingCommands();
        host.runQueuedTimeoutCallbacks(); // First project upate after typings are installed
        host.runQueuedTimeoutCallbacks(); // Update scheduled after the typings from unresolved imports are discovered again
        host.runQueuedTimeoutCallbacks();
        disableTypeAcquisition();
        host.runQueuedTimeoutCallbacks();
        verifyEnabledTypeAcquisition();
        baselineTsserverLogs("typeAquisition", "changes to typeAquisition when typing installer installs typing", session);
    });

    it("midway changes to typeAquisition when typing installer installs typing", () => {
        const { host, typingsInstaller, session, disableTypeAcquisition, verifyEnabledTypeAcquisition } = setup(
            /*hostHasBarTyping*/ false,
            /*enablebleTypeAquisition*/ true,
        );
        typingsInstaller.installer.executePendingCommands();
        disableTypeAcquisition();
        host.runQueuedTimeoutCallbacks(); // First project upate after typings are installed
        verifyEnabledTypeAcquisition();
        baselineTsserverLogs("typeAquisition", "midway changes to typeAquisition when typing installer installs typing", session);
    });

    it("receives update of typings after project changes", () => {
        const { host, typingsInstaller, session, disableTypeAcquisition, verifyEnabledTypeAcquisition } = setup(
            /*hostHasBarTyping*/ false,
            /*enablebleTypeAquisition*/ true,
        );
        disableTypeAcquisition();
        host.runQueuedTimeoutCallbacks(); // Update project
        typingsInstaller.installer.executePendingCommands();
        host.runQueuedTimeoutCallbacks();
        verifyEnabledTypeAcquisition();
        baselineTsserverLogs("typeAquisition", "receives update of typings after project changes", session);
    });

    it("change after enabling typeAquisition", () => {
        const { host, typingsInstaller, session, verifyEnabledTypeAcquisition } = setup(
            /*hostHasBarTyping*/ true,
            /*enablebleTypeAquisition*/ false,
        );
        verifyEnabledTypeAcquisition();
        typingsInstaller.installer.executePendingCommands();
        host.runQueuedTimeoutCallbacks();
        host.runQueuedTimeoutCallbacks();
        host.runQueuedTimeoutCallbacks();
        baselineTsserverLogs("typeAquisition", "change after enabling typeAquisition", session);
    });

    function setup(
        hostHasBarTyping: boolean,
        enablebleTypeAquisition: boolean,
    ) {
        const globalTypingsCacheLocation = "/users/user/projects/typings";
        const host = createServerHost({
            "/users/user/projects/project1/app.js": `var x = require('bar');`,
            "/users/user/projects/project1/node_modules/bar/index.js": "export const x = 1",
        });
        typeAcquisition(enablebleTypeAquisition);
        const barTyping: FileWithTypingPackageName = {
            path: `${globalTypingsCacheLocation}/node_modules/@types/bar/index.d.ts`,
            content: "export const x = 1;",
            typings: "bar",
        };
        if (hostHasBarTyping) host.ensureFileOrFolder(barTyping);
        const logger = createLoggerWithInMemoryLogs(host);
        const typingsInstaller = new TestTypingsInstaller(
            host,
            logger,
            { installAction: [[barTyping]], globalTypingsCacheLocation, typesRegistry: "bar" },
        );
        const session = createSession(host, { typingsInstaller, globalTypingsCacheLocation, logger });
        openFilesForSession(["/users/user/projects/project1/app.js"], session);
        return { host, typingsInstaller, session, disableTypeAcquisition, verifyEnabledTypeAcquisition };

        function typeAcquisition(enable: boolean) {
            host.writeFile("/users/user/projects/project1/jsconfig.json", config(enable));
        }

        function config(enablebleTypeAquisition: boolean) {
            return JSON.stringify(
                {
                    compilerOptions: {
                        allowJs: true,
                        traceResolution: true,
                    },
                    typeAcquisition: enablebleTypeAquisition ? undefined : { enable: false },
                },
                undefined,
                " ",
            );
        }

        function verifyEnabledTypeAcquisition() {
            typeAcquisition(/*enable*/ true);
            host.runQueuedTimeoutCallbacks();
            host.runQueuedTimeoutCallbacks();
            host.runQueuedTimeoutCallbacks();
        }

        function disableTypeAcquisition() {
            typeAcquisition(/*enable*/ false);
        }
    }
});
