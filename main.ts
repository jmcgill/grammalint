import { program } from 'commander';
import { choose, prompt } from 'promptly';
import chalk from 'chalk';
import YAML from 'yaml';
import path from 'path';

import { check, replaceAll } from "gramma";
import * as fs from "fs";
// import marked
// const { marked } = require('marked');

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
type CheckResult = UnwrapPromise<ReturnType<typeof check>>;
type GrammaError = CheckResult["matches"][0];

const display = console.log;

async function askHowToHandle(error: GrammaError, fingerprint: string) {
    const { text, offset, length } = error.context;
    const highlightedError = `\t${text.substr(0, offset)}${chalk.bgGreen(text.substr(offset, length))}${text.substr(offset + length)}`;

    const options = error.replacements.map(i => `${i.value}`);

    display(chalk.red(error.message));
    display(highlightedError);
    display('How should this issue be resolved?')
    for (let i = 0; i < options.length; ++i) {
        display(`\t${chalk.blue('(' + (i + 1) + ')')} ${options[i]}`)
    }
    display(`\t${chalk.blue('(a)')} Add to dictionary`)
    display(`\t${chalk.blue('(c)')} Custom`);
    display(`\t${chalk.blue('(i)')} Ignore`);

    // Generate a set of valid choices, with numeric choices for each replacement suggested by Gramma plus the
    // additional options a, c & i.
    const opt = await choose('> ', [...Array.from({length: options.length}, (_, i) => `${i + 1}`), 'i', 'a', 'c']);

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
        }
    }

    // Replace this word with
    if (opt === 'c') {
        const replacement = await prompt('...');
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
    }
}

async function checkGrammar(directory: string, file: string, interactive: boolean) {
    let text = fs.readFileSync(path.join(directory, file), 'utf-8');
    const ignorePath = path.join(directory, '.grammaignore');
    const configPath = path.join(directory, '.gramma.json');

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
    const r = await check(text, {
        ...config,
        markdown: true,
    });

    const replacements = [];
    const errors = [];

    for (const error of r.matches as GrammaError[]) {
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
            const {ignored, added, replaced} = await askHowToHandle(error, fingerprint);
            if (ignored) {
                ignoredErrors.push(ignored);
            }
            if (added) {
                config.dictionary.push(added);
            }
            if (replaced) {
                replacements.push(replaced);
            }
        } else {
            const {text, offset, length} = error.context;
            const highlightedError = `\t${text.substr(0, offset)}${chalk.bgGreen(text.substr(offset, length))}${text.substr(offset + length)}`;
            errors.push(`${file}\t${error.message}: ${highlightedError}`)
        }
    }

    // Update file
    const updated = replaceAll(text, replacements)
    fs.writeFileSync(path.join(directory, file), updated);

    // Update local configuration
    fs.writeFileSync(path.join(directory, '.gramma.json'), JSON.stringify(config, null, 4));
    fs.writeFileSync(ignorePath, ignoredErrors.join('\n'));

    return errors;
}

interface Options {
    interactive: boolean;
}

async function run(directory: string, options: Options) {
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
        program.error(`${errors.length} errors found`, { exitCode: 2, code: 'linterrors' });
    }
}

(async function main() {
    program
        .version('0.0.1')
        .arguments('<directory>')
        .option('--interactive')
        .action(run);
    program.parse();
})();
