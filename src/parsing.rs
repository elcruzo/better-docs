use serde::{Deserialize, Serialize};
use std::path::Path;
use tree_sitter::{Parser, Query, QueryCursor, Node};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Language {
    Python, TypeScript, JavaScript, Rust, Go, Java, Cpp, Ruby, Php, Unknown,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Symbol {
    pub name: String,
    pub kind: String,
    pub range: (usize, usize),
    pub content_preview: String,
    pub docstring: Option<String>,
    pub signature: Option<String>,
    pub params: Vec<Param>,
    pub return_type: Option<String>,
    pub visibility: Option<String>,
    pub parent_class: Option<String>,
    pub decorators: Vec<String>,
    pub calls: Vec<String>,
    pub bases: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Param {
    pub name: String,
    pub type_annotation: Option<String>,
    pub default: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Import {
    pub raw: String,
    pub source: Option<String>,
    pub names: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ParsingResult {
    pub language: Language,
    pub symbols: Vec<Symbol>,
    pub imports: Vec<Import>,
    pub exports: Vec<String>,
}

pub fn detect_language(filename: &str) -> Language {
    match Path::new(filename).extension().and_then(|e| e.to_str()) {
        Some("py" | "pyw") => Language::Python,
        Some("ts" | "tsx") => Language::TypeScript,
        Some("js" | "jsx" | "mjs" | "cjs") => Language::JavaScript,
        Some("rs") => Language::Rust,
        Some("go") => Language::Go,
        Some("java") => Language::Java,
        Some("cpp" | "cxx" | "hpp" | "h") => Language::Cpp,
        Some("rb") => Language::Ruby,
        Some("php") => Language::Php,
        _ => Language::Unknown,
    }
}

fn get_ts_language(lang: Language) -> tree_sitter::Language {
    match lang {
        Language::Python => tree_sitter_python::language(),
        Language::TypeScript => tree_sitter_typescript::language_typescript(),
        Language::JavaScript => tree_sitter_javascript::language(),
        Language::Rust => tree_sitter_rust::language(),
        Language::Go => tree_sitter_go::language(),
        Language::Java => tree_sitter_java::language(),
        Language::Cpp => tree_sitter_cpp::language(),
        Language::Ruby => tree_sitter_ruby::language(),
        Language::Php => tree_sitter_php::language_php(),
        Language::Unknown => unreachable!(),
    }
}

pub fn parse_content(filename: &str, content: &str) -> ParsingResult {
    let language = detect_language(filename);
    if language == Language::Unknown {
        return ParsingResult { language, symbols: vec![], imports: vec![], exports: vec![] };
    }

    let mut parser = Parser::new();
    let ts_lang = get_ts_language(language);
    parser.set_language(&ts_lang).expect("lang load failed");
    let tree = parser.parse(content, None).expect("parse failed");
    let root = tree.root_node();

    let symbols = extract_symbols(root, content, language);
    let imports = extract_imports(root, content, language);
    let exports = extract_exports(root, content, language);
    // Extract calls from all function/method bodies
    let calls_map = extract_call_graph(root, content, language);
    // Merge calls into symbols
    let symbols = symbols.into_iter().map(|mut s| {
        if let Some(c) = calls_map.get(&s.name) {
            s.calls = c.clone();
        }
        s
    }).collect();

    ParsingResult { language, symbols, imports, exports }
}

fn extract_imports(root: Node, source: &str, lang: Language) -> Vec<Import> {
    let query_str = match lang {
        Language::Python => "(import_statement) @imp\n(import_from_statement) @imp",
        Language::TypeScript | Language::JavaScript => "(import_statement) @imp",
        Language::Rust => "(use_declaration) @imp",
        Language::Go => "(import_declaration) @imp",
        Language::Java => "(import_declaration) @imp",
        Language::Cpp => "(preproc_include) @imp",
        Language::Ruby => "(call method: (identifier) @method (#eq? @method \"require\")) @imp",
        Language::Php => "(namespace_use_declaration) @imp",
        Language::Unknown => return vec![],
    };

    let ts_lang = get_ts_language(lang);
    let Ok(query) = Query::new(&ts_lang, query_str) else { return vec![] };
    let mut cursor = QueryCursor::new();
    cursor.matches(&query, root, source.as_bytes())
        .filter_map(|m| {
            m.captures.first().and_then(|c| {
                let raw = c.node.utf8_text(source.as_bytes()).ok()?.to_string();
                let (source_mod, names) = parse_import_details(&raw, lang);
                Some(Import { raw, source: source_mod, names })
            })
        })
        .collect()
}

fn parse_import_details(raw: &str, lang: Language) -> (Option<String>, Vec<String>) {
    match lang {
        Language::Python => {
            // "from foo.bar import baz, qux" or "import foo.bar"
            if raw.starts_with("from ") {
                let parts: Vec<&str> = raw.splitn(2, " import ").collect();
                let source = parts.first().map(|s| s.trim_start_matches("from ").trim().to_string());
                let names = parts.get(1).map(|s| s.split(',').map(|n| n.trim().to_string()).collect()).unwrap_or_default();
                (source, names)
            } else {
                let name = raw.trim_start_matches("import ").trim().to_string();
                (None, vec![name])
            }
        }
        Language::TypeScript | Language::JavaScript => {
            // "import { X, Y } from 'module'" or "import X from 'module'"
            if let Some(from_idx) = raw.find(" from ") {
                let source = raw[from_idx+6..].trim().trim_matches(|c| c == '\'' || c == '"' || c == ';').to_string();
                let names_part = &raw[..from_idx];
                let names: Vec<String> = names_part.replace("import", "").replace('{', "").replace('}', "")
                    .split(',').map(|n| n.trim().to_string()).filter(|n| !n.is_empty()).collect();
                (Some(source), names)
            } else {
                (None, vec![raw.to_string()])
            }
        }
        _ => (None, vec![raw.to_string()]),
    }
}

fn extract_exports(root: Node, source: &str, lang: Language) -> Vec<String> {
    let query_str = match lang {
        Language::TypeScript | Language::JavaScript => "(export_statement) @exp",
        Language::Rust => "(visibility_modifier) @exp",
        Language::Go => return extract_go_exports(root, source),
        _ => return vec![],
    };
    let ts_lang = get_ts_language(lang);
    let Ok(query) = Query::new(&ts_lang, query_str) else { return vec![] };
    let mut cursor = QueryCursor::new();
    let mut exports = vec![];
    for m in cursor.matches(&query, root, source.as_bytes()) {
        if let Some(c) = m.captures.first() {
            if let Ok(text) = c.node.utf8_text(source.as_bytes()) {
                exports.push(text.to_string());
            }
        }
    }
    exports
}

fn extract_go_exports(root: Node, source: &str) -> Vec<String> {
    // In Go, exported symbols start with uppercase
    let mut exports = vec![];
    let mut walk = root.walk();
    for node in root.children(&mut walk) {
        if let Some(name_node) = node.child_by_field_name("name") {
            if let Ok(name) = name_node.utf8_text(source.as_bytes()) {
                if name.starts_with(|c: char| c.is_uppercase()) {
                    exports.push(name.to_string());
                }
            }
        }
    }
    exports
}

fn extract_docstring(node: Node, source: &str, lang: Language) -> Option<String> {
    match lang {
        Language::Python => {
            // Python: docstring is the first expression_statement > string in the function body
            let body = node.child_by_field_name("body")?;
            let first = body.named_child(0)?;
            if first.kind() == "expression_statement" {
                let inner = first.named_child(0)?;
                if inner.kind() == "string" {
                    return inner.utf8_text(source.as_bytes()).ok()
                        .map(|s| s.trim_matches('"').trim_matches('\'').trim().to_string());
                }
            }
            // Fallback: check preceding comment
            let prev = node.prev_named_sibling()?;
            if prev.kind() == "comment" {
                return prev.utf8_text(source.as_bytes()).ok()
                    .map(|s| s.trim_start_matches('#').trim().to_string());
            }
            None
        }
        Language::JavaScript | Language::TypeScript | Language::Java | Language::Cpp | Language::Php => {
            let prev = node.prev_named_sibling()?;
            if prev.kind() == "comment" {
                Some(prev.utf8_text(source.as_bytes()).ok()?
                    .trim_start_matches("//").trim_start_matches("/*").trim_end_matches("*/").trim().to_string())
            } else { None }
        }
        Language::Rust => {
            // Collect consecutive doc comments above the node
            let mut docs = vec![];
            let mut sibling = node.prev_named_sibling();
            while let Some(s) = sibling {
                if s.kind() == "line_comment" || s.kind() == "block_comment" {
                    if let Ok(text) = s.utf8_text(source.as_bytes()) {
                        docs.push(text.trim_start_matches("///").trim_start_matches("//!").trim_start_matches("//").trim().to_string());
                    }
                    sibling = s.prev_named_sibling();
                } else {
                    break;
                }
            }
            docs.reverse();
            if docs.is_empty() { None } else { Some(docs.join("\n")) }
        }
        Language::Go => {
            let prev = node.prev_named_sibling()?;
            if prev.kind() == "comment" {
                Some(prev.utf8_text(source.as_bytes()).ok()?
                    .trim_start_matches("//").trim().to_string())
            } else { None }
        }
        _ => None,
    }
}

fn extract_symbols(root: Node, source: &str, lang: Language) -> Vec<Symbol> {
    let mut symbols = Vec::new();
    collect_symbols(root, source, lang, None, &mut symbols);
    symbols
}

fn collect_symbols(node: Node, source: &str, lang: Language, parent: Option<&str>, out: &mut Vec<Symbol>) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match (lang, child.kind()) {
            // Python
            (Language::Python, "function_definition") | (Language::Python, "decorated_definition") => {
                let (def_node, decorators) = if child.kind() == "decorated_definition" {
                    let decos = extract_decorators(child, source);
                    (child.child_by_field_name("definition").unwrap_or(child), decos)
                } else {
                    (child, vec![])
                };
                if let Some(sym) = build_symbol(def_node, source, lang, if parent.is_some() { "method" } else { "function" }, parent, decorators) {
                    out.push(sym);
                }
            }
            (Language::Python, "class_definition") => {
                let name = child.child_by_field_name("name")
                    .and_then(|n| n.utf8_text(source.as_bytes()).ok())
                    .unwrap_or("").to_string();
                let bases = extract_bases(child, source, lang);
                if let Some(mut sym) = build_symbol(child, source, lang, "class", parent, vec![]) {
                    sym.bases = bases;
                    out.push(sym);
                }
                if !name.is_empty() {
                    collect_symbols(child, source, lang, Some(&name), out);
                }
            }

            // TypeScript / JavaScript
            (Language::TypeScript | Language::JavaScript, "function_declaration") => {
                if let Some(sym) = build_symbol(child, source, lang, "function", parent, vec![]) {
                    out.push(sym);
                }
            }
            (Language::TypeScript | Language::JavaScript, "class_declaration") => {
                let name = child.child_by_field_name("name")
                    .and_then(|n| n.utf8_text(source.as_bytes()).ok())
                    .unwrap_or("").to_string();
                let bases = extract_bases(child, source, lang);
                if let Some(mut sym) = build_symbol(child, source, lang, "class", parent, vec![]) {
                    sym.bases = bases;
                    out.push(sym);
                }
                if !name.is_empty() {
                    collect_symbols(child, source, lang, Some(&name), out);
                }
            }
            (Language::TypeScript | Language::JavaScript, "method_definition") => {
                if let Some(sym) = build_symbol(child, source, lang, "method", parent, vec![]) {
                    out.push(sym);
                }
            }
            (Language::TypeScript | Language::JavaScript, "lexical_declaration" | "variable_declaration") => {
                // const foo = () => {} or const foo = function() {}
                let mut walk2 = child.walk();
                for decl in child.children(&mut walk2) {
                    if decl.kind() == "variable_declarator" {
                        if let Some(value) = decl.child_by_field_name("value") {
                            if value.kind() == "arrow_function" || value.kind() == "function_expression" {
                                if let Some(sym) = build_symbol(decl, source, lang, "function", parent, vec![]) {
                                    out.push(sym);
                                }
                            }
                        }
                    }
                }
            }
            (Language::TypeScript, "interface_declaration") => {
                if let Some(sym) = build_symbol(child, source, lang, "class", parent, vec![]) {
                    out.push(sym);
                }
            }
            (Language::TypeScript, "type_alias_declaration") => {
                if let Some(sym) = build_symbol(child, source, lang, "class", parent, vec![]) {
                    out.push(sym);
                }
            }

            // Rust
            (Language::Rust, "function_item") => {
                if let Some(sym) = build_symbol(child, source, lang, "function", parent, vec![]) {
                    out.push(sym);
                }
            }
            (Language::Rust, "struct_item" | "enum_item" | "trait_item") => {
                if let Some(sym) = build_symbol(child, source, lang, "class", parent, vec![]) {
                    out.push(sym);
                }
            }
            (Language::Rust, "impl_item") => {
                let type_name = child.child_by_field_name("type")
                    .and_then(|n| n.utf8_text(source.as_bytes()).ok())
                    .unwrap_or("").to_string();
                if !type_name.is_empty() {
                    collect_symbols(child, source, lang, Some(&type_name), out);
                }
            }

            // Go
            (Language::Go, "function_declaration") => {
                if let Some(sym) = build_symbol(child, source, lang, "function", parent, vec![]) {
                    out.push(sym);
                }
            }
            (Language::Go, "method_declaration") => {
                if let Some(sym) = build_symbol(child, source, lang, "method", parent, vec![]) {
                    out.push(sym);
                }
            }
            (Language::Go, "type_declaration") => {
                if let Some(sym) = build_symbol(child, source, lang, "class", parent, vec![]) {
                    out.push(sym);
                }
            }

            // Java
            (Language::Java, "class_declaration" | "interface_declaration") => {
                let name = child.child_by_field_name("name")
                    .and_then(|n| n.utf8_text(source.as_bytes()).ok())
                    .unwrap_or("").to_string();
                let bases = extract_bases(child, source, lang);
                if let Some(mut sym) = build_symbol(child, source, lang, "class", parent, vec![]) {
                    sym.bases = bases;
                    out.push(sym);
                }
                if !name.is_empty() {
                    collect_symbols(child, source, lang, Some(&name), out);
                }
            }
            (Language::Java, "method_declaration" | "constructor_declaration") => {
                if let Some(sym) = build_symbol(child, source, lang, "method", parent, vec![]) {
                    out.push(sym);
                }
            }

            // C++
            (Language::Cpp, "function_definition") => {
                if let Some(sym) = build_symbol(child, source, lang, "function", parent, vec![]) {
                    out.push(sym);
                }
            }
            (Language::Cpp, "class_specifier") => {
                let name = child.child_by_field_name("name")
                    .and_then(|n| n.utf8_text(source.as_bytes()).ok())
                    .unwrap_or("").to_string();
                if let Some(sym) = build_symbol(child, source, lang, "class", parent, vec![]) {
                    out.push(sym);
                }
                if !name.is_empty() {
                    collect_symbols(child, source, lang, Some(&name), out);
                }
            }

            // Ruby
            (Language::Ruby, "method" | "singleton_method") => {
                if let Some(sym) = build_symbol(child, source, lang, "function", parent, vec![]) {
                    out.push(sym);
                }
            }
            (Language::Ruby, "class" | "module") => {
                let name = child.child_by_field_name("name")
                    .and_then(|n| n.utf8_text(source.as_bytes()).ok())
                    .unwrap_or("").to_string();
                if let Some(sym) = build_symbol(child, source, lang, "class", parent, vec![]) {
                    out.push(sym);
                }
                if !name.is_empty() {
                    collect_symbols(child, source, lang, Some(&name), out);
                }
            }

            // PHP
            (Language::Php, "function_definition") => {
                if let Some(sym) = build_symbol(child, source, lang, "function", parent, vec![]) {
                    out.push(sym);
                }
            }
            (Language::Php, "method_declaration") => {
                if let Some(sym) = build_symbol(child, source, lang, "method", parent, vec![]) {
                    out.push(sym);
                }
            }
            (Language::Php, "class_declaration") => {
                let name = child.child_by_field_name("name")
                    .and_then(|n| n.utf8_text(source.as_bytes()).ok())
                    .unwrap_or("").to_string();
                if let Some(sym) = build_symbol(child, source, lang, "class", parent, vec![]) {
                    out.push(sym);
                }
                if !name.is_empty() {
                    collect_symbols(child, source, lang, Some(&name), out);
                }
            }

            _ => {
                // Recurse into other nodes to find nested definitions
                collect_symbols(child, source, lang, parent, out);
            }
        }
    }
}

fn build_symbol(node: Node, source: &str, lang: Language, kind: &str, parent: Option<&str>, decorators: Vec<String>) -> Option<Symbol> {
    let name_node = node.child_by_field_name("name")
        .or_else(|| node.child_by_field_name("declarator")); // C++ function_declarator
    let name = match name_node {
        Some(n) => {
            // For C++ nested declarators
            let actual = n.child_by_field_name("declarator").unwrap_or(n);
            actual.utf8_text(source.as_bytes()).ok()?.to_string()
        }
        None => return None,
    };
    if name.is_empty() { return None; }

    let range = (node.start_position().row + 1, node.end_position().row + 1);

    // Full signature: everything up to the body
    let sig = extract_full_signature(node, source, lang);

    let docstring = extract_docstring(node, source, lang);
    let params = extract_params(node, source, lang);
    let return_type = extract_return_type(node, source, lang);
    let visibility = extract_visibility(node, source, lang);

    let preview = {
        let start = node.start_byte();
        let mut end = std::cmp::min(start + 120, node.end_byte());
        while end < source.len() && !source.is_char_boundary(end) { end += 1; }
        source[start..end].lines().next().unwrap_or("").to_string()
    };

    Some(Symbol {
        name,
        kind: kind.to_string(),
        range,
        content_preview: preview,
        docstring,
        signature: sig,
        params,
        return_type,
        visibility,
        parent_class: parent.map(|s| s.to_string()),
        decorators,
        calls: vec![],
        bases: vec![],
    })
}

fn extract_full_signature(node: Node, source: &str, lang: Language) -> Option<String> {
    // Get everything from the start of the node to the start of the body
    let body_field = match lang {
        Language::Python => "body",
        Language::Rust => "body",
        Language::Go => "body",
        Language::Java => "body",
        Language::TypeScript | Language::JavaScript => "body",
        _ => "body",
    };
    let start = node.start_byte();
    let end = node.child_by_field_name(body_field)
        .map(|b| b.start_byte())
        .unwrap_or_else(|| std::cmp::min(start + 300, node.end_byte()));
    let mut safe_end = end;
    while safe_end < source.len() && !source.is_char_boundary(safe_end) { safe_end += 1; }
    let sig = source[start..safe_end].trim_end().trim_end_matches('{').trim_end_matches(':').trim();
    if sig.is_empty() { None } else { Some(sig.to_string()) }
}

fn extract_params(node: Node, source: &str, _lang: Language) -> Vec<Param> {
    let params_node = node.child_by_field_name("parameters")
        .or_else(|| node.child_by_field_name("formal_parameters"));
    let params_node = match params_node {
        Some(n) => n,
        None => return vec![],
    };
    let mut params = Vec::new();
    let mut walk = params_node.walk();
    for child in params_node.named_children(&mut walk) {
        let name = child.child_by_field_name("name")
            .or_else(|| child.child_by_field_name("pattern"))
            .and_then(|n| n.utf8_text(source.as_bytes()).ok())
            .unwrap_or_else(|| child.utf8_text(source.as_bytes()).unwrap_or(""))
            .to_string();
        let type_ann = child.child_by_field_name("type")
            .and_then(|n| n.utf8_text(source.as_bytes()).ok())
            .map(|s| s.to_string());
        let default = child.child_by_field_name("value")
            .or_else(|| child.child_by_field_name("default_value"))
            .and_then(|n| n.utf8_text(source.as_bytes()).ok())
            .map(|s| s.to_string());
        if !name.is_empty() && name != "self" && name != "cls" {
            params.push(Param { name, type_annotation: type_ann, default });
        }
    }
    params
}

fn extract_return_type(node: Node, source: &str, _lang: Language) -> Option<String> {
    node.child_by_field_name("return_type")
        .or_else(|| node.child_by_field_name("result"))
        .and_then(|n| n.utf8_text(source.as_bytes()).ok())
        .map(|s| s.trim_start_matches("->").trim_start_matches(':').trim().to_string())
}

fn extract_visibility(node: Node, source: &str, lang: Language) -> Option<String> {
    match lang {
        Language::Rust => {
            // Check for visibility_modifier child
            let mut walk = node.walk();
            for child in node.children(&mut walk) {
                if child.kind() == "visibility_modifier" {
                    return child.utf8_text(source.as_bytes()).ok().map(|s| s.to_string());
                }
            }
            None
        }
        Language::Java | Language::Php | Language::Cpp => {
            // Check for modifiers
            if let Some(mods) = node.child_by_field_name("modifiers") {
                return mods.utf8_text(source.as_bytes()).ok().map(|s| s.to_string());
            }
            let mut walk = node.walk();
            let found = node.children(&mut walk)
                .find(|c| c.kind() == "modifiers" || c.kind() == "access_specifier")
                .and_then(|n| n.utf8_text(source.as_bytes()).ok().map(|s| s.to_string()));
            found
        }
        Language::TypeScript | Language::JavaScript => {
            // Check for export_statement parent
            if let Some(p) = node.parent() {
                if p.kind() == "export_statement" {
                    return Some("export".to_string());
                }
            }
            None
        }
        Language::Python => {
            // Convention: _ prefix = private
            let name = node.child_by_field_name("name")
                .and_then(|n| n.utf8_text(source.as_bytes()).ok())
                .unwrap_or("");
            if name.starts_with("__") && name.ends_with("__") { Some("dunder".to_string()) }
            else if name.starts_with('_') { Some("private".to_string()) }
            else { Some("public".to_string()) }
        }
        _ => None,
    }
}

fn extract_decorators(node: Node, source: &str) -> Vec<String> {
    let mut decos = vec![];
    let mut walk = node.walk();
    for child in node.children(&mut walk) {
        if child.kind() == "decorator" {
            if let Ok(text) = child.utf8_text(source.as_bytes()) {
                decos.push(text.trim().to_string());
            }
        }
    }
    decos
}

fn extract_bases(node: Node, source: &str, lang: Language) -> Vec<String> {
    let mut bases = vec![];
    match lang {
        Language::Python => {
            if let Some(args) = node.child_by_field_name("superclasses") {
                let mut walk = args.walk();
                for child in args.named_children(&mut walk) {
                    if let Ok(text) = child.utf8_text(source.as_bytes()) {
                        bases.push(text.to_string());
                    }
                }
            }
        }
        Language::TypeScript | Language::JavaScript | Language::Java => {
            // Look for heritage clauses or superclass
            let mut walk = node.walk();
            for child in node.children(&mut walk) {
                if child.kind() == "class_heritage" || child.kind() == "extends_clause"
                    || child.kind() == "superclass" || child.kind() == "implements_clause"
                    || child.kind() == "super_interfaces" {
                    if let Ok(text) = child.utf8_text(source.as_bytes()) {
                        let cleaned = text.replace("extends", "").replace("implements", "").trim().to_string();
                        for b in cleaned.split(',') {
                            let b = b.trim();
                            if !b.is_empty() { bases.push(b.to_string()); }
                        }
                    }
                }
            }
        }
        _ => {}
    }
    bases
}

use std::collections::HashMap;

fn extract_call_graph(root: Node, source: &str, lang: Language) -> HashMap<String, Vec<String>> {
    // For each function/method, find what function names it calls
    let query_str = match lang {
        Language::Python => r#"
            (function_definition name: (identifier) @fn_name body: (block) @body) @fn
            (decorated_definition definition: (function_definition name: (identifier) @fn_name body: (block) @body)) @fn
        "#,
        Language::TypeScript | Language::JavaScript => r#"
            (function_declaration name: (identifier) @fn_name body: (statement_block) @body) @fn
            (method_definition name: (property_identifier) @fn_name body: (statement_block) @body) @fn
        "#,
        Language::Rust => r#"
            (function_item name: (identifier) @fn_name body: (block) @body) @fn
        "#,
        Language::Go => r#"
            (function_declaration name: (identifier) @fn_name body: (block) @body) @fn
            (method_declaration name: (field_identifier) @fn_name body: (block) @body) @fn
        "#,
        Language::Java => r#"
            (method_declaration name: (identifier) @fn_name body: (block) @body) @fn
        "#,
        _ => return HashMap::new(),
    };

    let ts_lang = get_ts_language(lang);
    let Ok(query) = Query::new(&ts_lang, query_str) else { return HashMap::new() };
    let mut cursor = QueryCursor::new();
    let mut result: HashMap<String, Vec<String>> = HashMap::new();

    for m in cursor.matches(&query, root, source.as_bytes()) {
        let mut fn_name = String::new();
        let mut body_node: Option<Node> = None;
        for capture in m.captures {
            let cap_name: &str = &query.capture_names()[capture.index as usize];
            if cap_name == "fn_name" {
                fn_name = capture.node.utf8_text(source.as_bytes()).unwrap_or("").to_string();
            } else if cap_name == "body" {
                body_node = Some(capture.node);
            }
        }
        if fn_name.is_empty() { continue; }
        if let Some(body) = body_node {
            let calls = collect_calls_in_node(body, source);
            if !calls.is_empty() {
                result.insert(fn_name, calls);
            }
        }
    }
    result
}

fn collect_calls_in_node(node: Node, source: &str) -> Vec<String> {
    let mut calls = Vec::new();
    let mut stack = vec![node];
    while let Some(n) = stack.pop() {
        if n.kind() == "call_expression" || n.kind() == "call" {
            // Get the function name being called
            if let Some(func) = n.child_by_field_name("function") {
                if let Ok(text) = func.utf8_text(source.as_bytes()) {
                    // Extract just the function name (last part of dotted access)
                    let name = text.rsplit('.').next().unwrap_or(text).to_string();
                    if !name.is_empty() && !calls.contains(&name) {
                        calls.push(name);
                    }
                }
            }
        }
        let mut walk = n.walk();
        for child in n.children(&mut walk) {
            stack.push(child);
        }
    }
    calls
}
