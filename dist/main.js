"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const promptly_1 = require("promptly");
const chalk_1 = __importDefault(require("chalk"));
const path_1 = __importDefault(require("path"));
const gramma_1 = require("gramma");
const fs = __importStar(require("fs"));
const display = console.log;
async function askHowToHandle(error, fingerprint) {
    const { text, offset, length } = error.context;
    const highlightedError = `\t${text.substr(0, offset)}${chalk_1.default.bgGreen(text.substr(offset, length))}${text.substr(offset + length)}`;
    const options = error.replacements.map(i => `${i.value}`);
    display(chalk_1.default.red(error.message));
    display(highlightedError);
    display('How should this issue be resolved?');
    for (let i = 0; i < options.length; ++i) {
        display(`\t${chalk_1.default.blue('(' + (i + 1) + ')')} ${options[i]}`);
    }
    display(`\t${chalk_1.default.blue('(a)')} Add to dictionary`);
    display(`\t${chalk_1.default.blue('(c)')} Custom`);
    display(`\t${chalk_1.default.blue('(i)')} Ignore`);
    // Generate a set of valid choices, with numeric choices for each replacement suggested by Gramma plus the
    // additional options a, c & i.
    const opt = await (0, promptly_1.choose)('> ', [...Array.from({ length: options.length }, (_, i) => `${i + 1}`), 'i', 'a', 'c']);
    // Ignore this error, now and in the future
    if (opt === 'i') {
        return {
            ignored: fingerprint
        };
    }
    // Add this word to the domain specific dictionary
    if (opt === 'a') {
        return {
            added: error.word,
        };
    }
    // Replace this word with
    if (opt === 'c') {
        const replacement = await (0, promptly_1.prompt)('...');
        return {
            replaced: {
                offset: error.offset,
                length: error.length,
                change: replacement,
            },
        };
    }
    return {
        replaced: {
            offset: error.offset,
            length: error.length,
            change: options[parseInt(opt, 10) - 1]
        }
    };
}
async function checkGrammar(directory, file, interactive) {
    let text = fs.readFileSync(path_1.default.join(directory, file), 'utf-8');
    const ignorePath = path_1.default.join(directory, '.grammaignore');
    const configPath = path_1.default.join(directory, '.gramma.json');
    if (!fs.existsSync(configPath)) {
        return [];
    }
    // Markdown files cannot be annotated with ignore-next-line directives, so instead we commit those exceptions
    // to a peer file.
    if (!fs.existsSync(ignorePath)) {
        fs.writeFileSync(ignorePath, '');
    }
    const ignoredErrors = fs.readFileSync(ignorePath, 'utf-8').split('\n');
    // TODO(jimmy): Walk up the tree until we find this file
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const r = await (0, gramma_1.check)(text, {
        ...config,
        markdown: true,
    });
    const replacements = [];
    const errors = [];
    for (const error of r.matches) {
        // We construct a unique fingerprint for each error, to allow us to record when an issue is ignored.
        const fingerprint = `${error.rule.id}--${error.word}--${file}`;
        // Has a user already marked this error as an intended exception?
        if (ignoredErrors.includes(fingerprint)) {
            continue;
        }
        // We assume that terms in `ticks` are likely to be terms of art, and should not be checked.
        if (error.word.trim().startsWith('`')) {
            continue;
        }
        if (interactive) {
            const { ignored, added, replaced } = await askHowToHandle(error, fingerprint);
            if (ignored) {
                ignoredErrors.push(ignored);
            }
            if (added) {
                config.dictionary.push(added);
            }
            if (replaced) {
                replacements.push(replaced);
            }
        }
        else {
            const { text, offset, length } = error.context;
            const highlightedError = `\t${text.substr(0, offset)}${chalk_1.default.bgGreen(text.substr(offset, length))}${text.substr(offset + length)}`;
            errors.push(`${file}\t${error.message}: ${highlightedError}`);
        }
    }
    // Update file
    const updated = (0, gramma_1.replaceAll)(text, replacements);
    fs.writeFileSync(path_1.default.join(directory, file), updated);
    // Update local configuration
    fs.writeFileSync(path_1.default.join(directory, '.gramma.json'), JSON.stringify(config, null, 4));
    fs.writeFileSync(ignorePath, ignoredErrors.join('\n'));
    return errors;
}
async function run(directory, options) {
    const files = fs.readdirSync(directory);
    const errors = [];
    for (const file of files) {
        if (!file.endsWith('.md')) {
            continue;
        }
        errors.push(...await checkGrammar(directory, file, options.interactive));
    }
    // Display errors
    for (const error of errors) {
        console.log(error);
    }
    if (errors.length > 0) {
        commander_1.program.error(`${errors.length} errors found`, { exitCode: 2, code: 'linterrors' });
    }
}
(async function main() {
    commander_1.program
        .version('0.0.1')
        .arguments('<directory>')
        .option('--interactive')
        .action(run);
    commander_1.program.parse();
})();
//# sourceMappingURL=main.js.map