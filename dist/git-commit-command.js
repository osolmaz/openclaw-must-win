const GIT_OPTIONS_WITH_VALUE = new Set([
    "-C",
    "-c",
    "--config-env",
    "--git-dir",
    "--namespace",
    "--work-tree",
]);
const ASSIGNMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)=/;
export function hasAttributableGitCommit(command) {
    return findInsertionPoints(command).length > 0;
}
export function prefixGitCommitCommands(command, prefix) {
    const insertionPoints = findInsertionPoints(command);
    let rewritten = command;
    for (const point of insertionPoints) {
        rewritten = `${rewritten.slice(0, point)}${prefix}${rewritten.slice(point)}`;
    }
    return rewritten;
}
function findInsertionPoints(command) {
    if (hasUnquotedHereDocument(command) || hasUnquotedCommandSubstitution(command)) {
        return [];
    }
    return findCommandSegments(command)
        .map((span) => findGitCommitInsertion(command, span))
        .filter((point) => point !== undefined)
        .sort((left, right) => right - left);
}
function hasUnquotedHereDocument(command) {
    let state = { escaped: false, quote: "none" };
    for (let index = 0; index < command.length; index += 1) {
        const character = command[index];
        if (character === undefined) {
            continue;
        }
        if (!state.escaped &&
            state.quote === "none" &&
            character === "<" &&
            command[index + 1] === "<") {
            return true;
        }
        state = advanceScanState(state, character);
    }
    return false;
}
function hasUnquotedCommandSubstitution(command) {
    let state = { escaped: false, quote: "none" };
    for (let index = 0; index < command.length; index += 1) {
        const character = command[index];
        if (character === undefined) {
            continue;
        }
        if (!state.escaped &&
            state.quote === "none" &&
            character === "$" &&
            command[index + 1] === "(") {
            return true;
        }
        state = advanceScanState(state, character);
    }
    return false;
}
function findCommandSegments(command) {
    const spans = [];
    let segmentStart = 0;
    let state = { escaped: false, quote: "none" };
    for (let index = 0; index < command.length; index += 1) {
        const character = command[index];
        if (character === undefined) {
            continue;
        }
        if (!state.escaped && state.quote === "none" && isCommandBoundary(character)) {
            spans.push({ start: segmentStart, end: index });
            segmentStart = skipRepeatedBoundary(command, index);
            index = segmentStart - 1;
            continue;
        }
        state = advanceScanState(state, character);
    }
    spans.push({ start: segmentStart, end: command.length });
    return spans;
}
function advanceScanState(state, character) {
    if (state.escaped) {
        return { ...state, escaped: false };
    }
    if (state.quote === "none") {
        return advanceUnquotedScanState(character);
    }
    if (state.quote === "single") {
        return { escaped: false, quote: character === "'" ? "none" : "single" };
    }
    const closingCharacter = state.quote === "double" ? '"' : "`";
    return {
        escaped: character === "\\",
        quote: character === closingCharacter ? "none" : state.quote,
    };
}
function advanceUnquotedScanState(character) {
    const quoteByCharacter = {
        "'": "single",
        '"': "double",
        "`": "backtick",
    };
    return {
        escaped: character === "\\",
        quote: quoteByCharacter[character] ?? "none",
    };
}
function isCommandBoundary(character) {
    return character === ";" || character === "\n" || character === "|" || character === "&";
}
function skipRepeatedBoundary(command, index) {
    const next = command[index + 1];
    return next === command[index] && (next === "|" || next === "&") ? index + 2 : index + 1;
}
function findGitCommitInsertion(command, span) {
    const tokens = tokenizeSegment(command, span);
    const commandIndex = findCommandToken(tokens);
    if (commandIndex === undefined || !isGitCommand(tokens[commandIndex])) {
        return undefined;
    }
    if (hasGitConfigAssignment(tokens, commandIndex) ||
        hasExplicitHooksPathOption(tokens, commandIndex + 1)) {
        return undefined;
    }
    const subcommand = findGitSubcommand(tokens, commandIndex + 1);
    return subcommand?.value === "commit" ? tokens[commandIndex]?.start : undefined;
}
function tokenizeSegment(command, span) {
    const tokens = [];
    let index = span.start;
    while (index < span.end) {
        index = skipWhitespace(command, index, span.end);
        if (index >= span.end || command[index] === "#") {
            break;
        }
        const token = readToken(command, index, span.end);
        if (token.end === index) {
            break;
        }
        tokens.push(token);
        index = token.end;
    }
    return tokens;
}
function skipWhitespace(command, index, end) {
    let cursor = index;
    while (cursor < end && /\s/.test(command[cursor] ?? "")) {
        cursor += 1;
    }
    return cursor;
}
function readToken(command, start, end) {
    let cursor = start;
    let state = { dynamic: false, quote: "none", value: "" };
    while (cursor < end) {
        const character = command[cursor];
        if (character === undefined || (state.quote === "none" && /\s/.test(character))) {
            break;
        }
        const step = readTokenCharacter(command, cursor, state);
        state = step;
        cursor += step.consumed;
    }
    return {
        dynamic: state.dynamic || state.quote !== "none",
        end: cursor,
        start,
        value: state.value,
    };
}
function readTokenCharacter(command, cursor, state) {
    const character = command[cursor] ?? "";
    if (state.quote === "none") {
        return readUnquotedTokenCharacter(command, cursor, state, character);
    }
    if (state.quote === "single") {
        return {
            ...state,
            consumed: 1,
            quote: character === "'" ? "none" : state.quote,
            value: character === "'" ? state.value : state.value + character,
        };
    }
    return readDynamicQuotedTokenCharacter(command, cursor, state, character);
}
function readUnquotedTokenCharacter(command, cursor, state, character) {
    const quoteByCharacter = {
        "'": "single",
        '"': "double",
        "`": "backtick",
    };
    const openingQuote = quoteByCharacter[character];
    if (openingQuote !== undefined) {
        return {
            ...state,
            consumed: 1,
            dynamic: state.dynamic || openingQuote === "backtick",
            quote: openingQuote,
        };
    }
    const nextCharacter = command[cursor + 1];
    if (character === "\\" && nextCharacter !== undefined) {
        return { ...state, consumed: 2, value: state.value + nextCharacter };
    }
    return {
        ...state,
        consumed: 1,
        dynamic: state.dynamic || character === "$",
        value: state.value + character,
    };
}
function readDynamicQuotedTokenCharacter(command, cursor, state, character) {
    const closingCharacter = state.quote === "double" ? '"' : "`";
    if (character === closingCharacter) {
        return { ...state, consumed: 1, quote: "none" };
    }
    const nextCharacter = command[cursor + 1];
    if (character === "\\" && nextCharacter !== undefined) {
        return { ...state, consumed: 2, value: state.value + nextCharacter };
    }
    return {
        ...state,
        consumed: 1,
        dynamic: state.dynamic || character === "$" || state.quote === "backtick",
        value: state.value + character,
    };
}
function findCommandToken(tokens) {
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === undefined || token.dynamic) {
            return undefined;
        }
        if (!ASSIGNMENT_PATTERN.test(token.value)) {
            return index;
        }
    }
    return undefined;
}
function isGitCommand(token) {
    if (token === undefined || token.dynamic) {
        return false;
    }
    return token.value === "git" || token.value.endsWith("/git");
}
function hasGitConfigAssignment(tokens, commandIndex) {
    return tokens.slice(0, commandIndex).some((token) => {
        const name = ASSIGNMENT_PATTERN.exec(token.value)?.[1];
        return name === "GIT_CONFIG_COUNT" || name?.startsWith("GIT_CONFIG_KEY_") === true;
    });
}
function hasExplicitHooksPathOption(tokens, start) {
    let index = start;
    while (index < tokens.length) {
        const token = tokens[index];
        if (!isStaticGitOption(token)) {
            return false;
        }
        if (isHooksPathOption(tokens, index)) {
            return true;
        }
        index += optionConsumesNextValue(token.value) ? 2 : 1;
    }
    return false;
}
function isStaticGitOption(token) {
    return (token !== undefined && !token.dynamic && token.value !== "--" && token.value.startsWith("-"));
}
function isHooksPathOption(tokens, index) {
    const option = tokens[index]?.value ?? "";
    const lowercaseOption = option.toLowerCase();
    if (isSeparateConfigOption(option)) {
        return isHooksPathConfig(tokens[index + 1]?.value ?? "");
    }
    if (option.startsWith("-c")) {
        return isHooksPathConfig(option.slice(2));
    }
    return lowercaseOption.startsWith("--config-env=") && isHooksPathConfig(option.slice(13));
}
function isSeparateConfigOption(option) {
    return option === "-c" || option.toLowerCase() === "--config-env";
}
function isHooksPathConfig(value) {
    return value.toLowerCase().startsWith("core.hookspath=");
}
function findGitSubcommand(tokens, start) {
    let index = start;
    while (index < tokens.length) {
        const token = tokens[index];
        if (token === undefined || token.dynamic) {
            return undefined;
        }
        if (token.value === "--") {
            return tokens[index + 1];
        }
        if (!token.value.startsWith("-")) {
            return token;
        }
        index += optionConsumesNextValue(token.value) ? 2 : 1;
    }
    return undefined;
}
function optionConsumesNextValue(option) {
    return GIT_OPTIONS_WITH_VALUE.has(option);
}
//# sourceMappingURL=git-commit-command.js.map