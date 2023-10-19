import {
    Debug,
    Diagnostics,
    emptyArray,
    factory,
    FindAllReferences,
    getLocaleSpecificMessage,
    getTouchingPropertyName,
    Identifier,
    InitializedVariableDeclaration,
    isExportModifier,
    isIdentifier,
    isInitializedVariable,
    isParameter,
    isPropertyAccessExpression,
    isVariableDeclarationInVariableStatement,
    isVariableStatement,
    ParameterDeclaration,
    Program,
    PropertyAccessExpression,
    refactor,
    some,
    SourceFile,
    SymbolFlags,
    textChanges,
    TypeChecker
} from "../_namespaces/ts";
import {
    RefactorErrorInfo,
    registerRefactor,
} from "../_namespaces/ts.refactor";

const refactorName = "Destructure Object";
const refactorDescription = getLocaleSpecificMessage(Diagnostics.Destructure_object);

const destructureObjectAction = {
    name: refactorName,
    description: refactorDescription,
    kind: "refactor.destructure.object",
};

interface DestructureInfo {
    references: PropertyAccessExpression[];
    declaringIdentifier: Identifier
}

registerRefactor(refactorName, {
    kinds: [destructureObjectAction.kind],

    getAvailableActions(context) {
        const {
            file,
            program,
            preferences,
            startPosition,
            triggerReason,
        } = context;

        // tryWithReferenceToken is true below when triggerReason === "invoked", since we want to
        // always provide the refactor in the declaration site but only show it in references when
        // the refactor is explicitly invoked.
        const info = getDestructureInfo(file, startPosition, triggerReason === "invoked", program);
        if (!info) {
            return emptyArray;
        }

        if (!refactor.isRefactorErrorInfo(info)) {
            return [{
                name: refactorName,
                description: refactorDescription,
                actions: [destructureObjectAction],
            }];
        }

        if (preferences.provideRefactorNotApplicableReason) {
            return [{
                name: refactorName,
                description: refactorDescription,
                actions: [{
                    ...destructureObjectAction,
                    notApplicableReason: info.error,
                }],
            }];
        }

        return emptyArray;
    },

    getEditsForAction(context, actionName) {
        Debug.assert(actionName === refactorName, "Unexpected refactor invoked");

        const { file, program, startPosition } = context;

        // tryWithReferenceToken is true below since here we're already performing the refactor.
        // The trigger kind was only relevant when checking the availability of the refactor.
        const info = getDestructureInfo(file, startPosition, /*tryWithReferenceToken*/ true, program);
        if (!info || refactor.isRefactorErrorInfo(info)) {
            return undefined;
        }

        const { references, declaringIdentifier } = info;
        const edits = textChanges.ChangeTracker.with(context, tracker => {
            const usedNames = new Set<string>();
            for (const node of references) {
                tracker.replaceNode(file, node, node.name);
                usedNames.add(node.name.text);
            }

            const names = [...usedNames.values()].sort();
            tracker.replaceNode(file, declaringIdentifier, factory.createObjectBindingPattern(names.map(v => factory.createBindingElement(/*dotDotDotToken*/ undefined, /*propertyName*/ undefined, v))));
        });

        return { edits };
    },
});

function getDestructureInfo(file: SourceFile, startPosition: number, tryWithReferenceToken: boolean, program: Program): DestructureInfo | RefactorErrorInfo | undefined {
    const checker = program.getTypeChecker();
    const token = getTouchingPropertyName(file, startPosition);
    const parent = token.parent;

    if (!isIdentifier(token)) {
        return undefined;
    }

    // If triggered in a variable declaration, make sure it's not in a catch clause or for-loop
    // and that it has a value.
    if ((isInitializedVariable(parent) && isVariableDeclarationInVariableStatement(parent)) || isParameter(parent) ) {

        // Do not destructure a parameter that is already destructured
        if(!isIdentifier(parent.name)) return undefined;

        // Don't destructure the variable if it has multiple declarations.
        const symbol = checker.getMergedSymbol(parent.symbol);

        if (symbol.declarations?.length !== 1) {
            return { error: getLocaleSpecificMessage(Diagnostics.Variables_with_multiple_declarations_cannot_be_destructured) };
        }

        // Do not destructure if the variable is exported.
        if (isDeclarationExported(parent)) {
            return undefined;
        }

        // Find all references to the variable in the current file.
        const references = getReferenceNodes(parent, checker, file);

        if(!references) return undefined;

        return {
            references,
            declaringIdentifier: parent.name
        }
    }

    // Try finding the declaration and nodes to replace via the reference token.
    if (tryWithReferenceToken) {
        let definition = checker.resolveName(token.text, token, SymbolFlags.Value, /*excludeGlobals*/ false);
        definition = definition && checker.getMergedSymbol(definition);

        // Don't destructure the variable if it has multiple declarations.
        if (definition?.declarations?.length !== 1) {
            return { error: getLocaleSpecificMessage(Diagnostics.Variables_with_multiple_declarations_cannot_be_destructured) };
        }

        // Make sure we're not inlining something like "let foo;" or "for (let i = 0; i < 5; i++) {}".
        const declaration = definition.declarations[0];
        if ((!isInitializedVariable(declaration) || !isVariableDeclarationInVariableStatement(declaration)) && !isParameter(declaration)) {
            return undefined;
        }

        // Do not destructure a parameter that is already destructured
        if(!isIdentifier(declaration.name)) return undefined;

        // Do not destructure if the variable is exported.
        if (isDeclarationExported(declaration)) {
            return undefined;
        }

        // Find all references to the variable in the current file.
        const references = getReferenceNodes(declaration, checker, file);

        if(!references) return undefined;

        return {
            references,
            declaringIdentifier: declaration.name
        }
    }

    return { error: getLocaleSpecificMessage(Diagnostics.Could_not_find_variable_to_destructure) };
}

function isDeclarationExported(declaration: InitializedVariableDeclaration | ParameterDeclaration): boolean {
    const variableStatement = declaration.parent.parent;
    if(!isVariableStatement(variableStatement)) return false;
    return some(variableStatement.modifiers, isExportModifier);
}

function getReferenceNodes(declaration: InitializedVariableDeclaration | ParameterDeclaration, checker: TypeChecker, file: SourceFile): PropertyAccessExpression[] | undefined {
    const references: PropertyAccessExpression[] = [];
    const cannotDestructure = FindAllReferences.Core.eachSymbolReferenceInFile(declaration.name as Identifier, checker, file, ref => {
        // We can only convert to destructured object if the only usage type is property access
        if(!isPropertyAccessExpression(ref.parent)){
            return true;
        }

        // A conditional access (a?.b) cannot be destructured
        if(ref.parent.questionDotToken){
            return true;
        }

        references.push(ref.parent);
    });

    return references.length === 0 || cannotDestructure ? undefined : references;
}
