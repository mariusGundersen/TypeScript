import {
    ApplyCodeActionCommandResult,
    InstallPackageOptions,
    noop,
    notImplemented,
    Path,
    returnFalse,
    SortedReadonlyArray,
    TypeAcquisition,
} from "./_namespaces/ts";
import {
    Project,
    ProjectService,
} from "./_namespaces/ts.server";

export interface InstallPackageOptionsWithProject extends InstallPackageOptions {
    projectName: string;
    projectRootPath: Path;
}

// for backwards-compatibility
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface ITypingsInstaller {
    isKnownTypesPackageName(name: string): boolean;
    installPackage(options: InstallPackageOptionsWithProject): Promise<ApplyCodeActionCommandResult>;
    enqueueInstallTypingsRequest(p: Project, typeAcquisition: TypeAcquisition, unresolvedImports: SortedReadonlyArray<string> | undefined): void;
    attach(projectService: ProjectService): void;
    onProjectClosed(p: Project): void;
    onTypeAcquisitionDisabled?(p: Project): void;
    readonly globalTypingsCacheLocation: string | undefined;
}

export const nullTypingsInstaller: ITypingsInstaller = {
    isKnownTypesPackageName: returnFalse,
    // Should never be called because we never provide a types registry.
    installPackage: notImplemented,
    enqueueInstallTypingsRequest: noop,
    attach: noop,
    onProjectClosed: noop,
    globalTypingsCacheLocation: undefined!, // TODO: GH#18217
};
