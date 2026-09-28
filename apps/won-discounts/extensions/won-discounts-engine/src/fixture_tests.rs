// Every committed fixture (tests/fixtures/*.json, generated from the TS engine's
// scenarios) through both run functions natively: the output, written as
// JSON.stringify would write it, must equal the fixture's expected output
// character for character. The same fixtures also run through the compiled
// Wasm in the JS suites (tests/default.test.js and the app's
// function.contract test); this is the fast check `cargo test` gives.

use std::fs;
use std::path::Path;

use shopify_function::run_function_with_input;

use crate::cart_delivery_options_discounts_generate_run::cart_delivery_options_discounts_generate_run;
use crate::cart_lines_discounts_generate_run::cart_lines_discounts_generate_run;
use crate::output::JsonText;
use crate::schema;

/// The JSON value that follows `"key": ` (the fixture's first such key), as text.
fn value_after<'t>(text: &'t str, key: &str) -> &'t str {
    let needle = format!("\"{key}\": ");
    let start = text.find(&needle).unwrap_or_else(|| panic!("no {key}")) + needle.len();
    let bytes = text.as_bytes();
    let (mut depth, mut in_string, mut escaped) = (0i32, false, false);
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        if in_string {
            match (escaped, b) {
                (true, _) => escaped = false,
                (false, b'\\') => escaped = true,
                (false, b'"') => in_string = false,
                _ => {}
            }
            if !in_string && depth == 0 {
                return &text[start..=i];
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' | b'[' => depth += 1,
            b'}' | b']' => {
                depth -= 1;
                if depth == 0 {
                    return &text[start..=i];
                }
            }
            b',' | b'\n' if depth == 0 => return text[start..i].trim(),
            _ => {}
        }
    }
    panic!("unterminated {key}");
}

/// JSON text without the whitespace between tokens (the fixtures are pretty-printed).
fn minify(json: &str) -> String {
    let mut out = String::with_capacity(json.len());
    let (mut in_string, mut escaped) = (false, false);
    for c in json.chars() {
        if in_string {
            out.push(c);
            match (escaped, c) {
                (true, _) => escaped = false,
                (false, '\\') => escaped = true,
                (false, '"') => in_string = false,
                _ => {}
            }
        } else if c == '"' {
            in_string = true;
            out.push(c);
        } else if !c.is_whitespace() {
            out.push(c);
        }
    }
    out
}

fn run(export: &str, input: &str) -> String {
    match export {
        "cart-lines-discounts-generate-run" => run_function_with_input(
            |input: schema::cart_lines_discounts_generate_run::Input| {
                let mut json = JsonText::default();
                cart_lines_discounts_generate_run(input)?.write(&mut json)?;
                Ok(json.out)
            },
            input,
        ),
        "cart-delivery-options-discounts-generate-run" => run_function_with_input(
            |input: schema::cart_delivery_options_discounts_generate_run::Input| {
                let mut json = JsonText::default();
                cart_delivery_options_discounts_generate_run(input)?.write(&mut json)?;
                Ok(json.out)
            },
            input,
        ),
        other => panic!("unknown export {other}"),
    }
    .expect("the run never fails")
}

#[test]
fn every_fixture_produces_its_expected_output() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let mut files: Vec<_> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).collect();
    files.retain(|p| p.extension().is_some_and(|e| e == "json"));
    files.sort();
    assert!(files.len() >= 33, "expected the 33 committed fixtures, found {}", files.len());
    let mut failures = Vec::new();
    for file in &files {
        let text = fs::read_to_string(file).unwrap();
        let export = value_after(&text, "export").trim_matches('"');
        let got = run(export, value_after(&text, "input"));
        let expected = minify(value_after(&text, "output"));
        if got != expected {
            failures.push(format!("{}\n  got      {got}\n  expected {expected}", file.display()));
        }
    }
    assert!(failures.is_empty(), "{} of {} fixtures differ:\n{}", failures.len(), files.len(), failures.join("\n"));
}
