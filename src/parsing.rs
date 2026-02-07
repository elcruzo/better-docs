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
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ParsingResult {
    pub language: Language,
    pub symbols: Vec<Symbol>,
    pub imports: Vec<String>,
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
        Language::Php => tree_sitter_php::language(),
        Language::Unknown => unreachable!(),
    }
}

pub fn parse_content(filename: &str, content: &str) -> ParsingResult {
    let language = detect_language(filename);
    if language == Language::Unknown {
        return ParsingResult { language, symbols: vec![], imports: vec![] };
    }

    let mut parser = Parser::new();
    let ts_lang = get_ts_language(language);
    parser.set_language(ts_lang).expect("lang load failed");
    let tree = parser.parse(content, None).expect("parse failed");
    let root = tree.root_node();

    let symbols = extract_symbols(root, content, language);
    let imports = extract_imports(root, content, language);

    ParsingResult { language, symbols, imports }
}

fn extract_imports(root: Node, source: &str, lang: Language) -> Vec<String> {
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
    let Ok(query) = Query::new(ts_lang, query_str) else { return vec![] };
    let mut cursor = QueryCursor::new();
    cursor.matches(&query, root, source.as_bytes())
        .filter_map(|m| {
            m.captures.first().and_then(|c| {
                c.node.utf8_text(source.as_bytes()).ok().map(|s| s.to_string())
            })
        })
        .collect()
}

fn extract_docstring(node: Node, source: &str, lang: Language) -> Option<String> {
    let prev = node.prev_named_sibling()?;
    let text = prev.utf8_text(source.as_bytes()).ok()?;
    match lang {
        Language::Python => {
            let first_child = node.named_child(node.named_child_count().checked_sub(1).unwrap_or(0))?;
            if first_child.kind() == "expression_statement" {
                let inner = first_child.named_child(0)?;
                if inner.kind() == "string" {
                    return inner.utf8_text(source.as_bytes()).ok().map(|s| s.trim_matches('"').trim_matches('\'').trim().to_string());
                }
            }
            if prev.kind() == "comment" { Some(text.trim_start_matches('#').trim().to_string()) } else { None }
        }
        Language::JavaScript | Language::TypeScript | Language::Java | Language::Cpp | Language::Php => {
            if prev.kind() == "comment" {
                Some(text.trim_start_matches("//").trim_start_matches("/*").trim_end_matches("*/").trim().to_string())
            } else { None }
        }
        Language::Rust => {
            if prev.kind() == "line_comment" || prev.kind() == "block_comment" {
                Some(text.trim_start_matches("///").trim_start_matches("//").trim().to_string())
            } else { None }
        }
        Language::Go => {
            if prev.kind() == "comment" {
                Some(text.trim_start_matches("//").trim().to_string())
            } else { None }
        }
        _ => None,
    }
}

fn extract_symbols(root: Node, source: &str, lang: Language) -> Vec<Symbol> {
    let query_str = match lang {
        Language::Python => r#"
            (function_definition name: (identifier) @name) @function
            (class_definition name: (identifier) @name) @class
            (decorated_definition definition: (function_definition name: (identifier) @name)) @method
        "#,
        Language::TypeScript | Language::JavaScript => r#"
            (function_declaration name: (identifier) @name) @function
            (class_declaration name: (type_identifier) @name) @class
            (method_definition name: (property_identifier) @name) @method
            (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)]) @function
        "#,
        Language::Rust => r#"
            (function_item name: (identifier) @name) @function
            (struct_item name: (type_identifier) @name) @class
            (trait_item name: (type_identifier) @name) @class
            (impl_item type: (type_identifier) @name) @class
        "#,
        Language::Go => r#"
            (function_declaration name: (identifier) @name) @function
            (method_declaration name: (field_identifier) @name) @method
            (type_declaration (type_spec name: (type_identifier) @name)) @class
        "#,
        Language::Java => r#"
            (method_declaration name: (identifier) @name) @method
            (class_declaration name: (identifier) @name) @class
            (interface_declaration name: (identifier) @name) @class
        "#,
        Language::Cpp => r#"
            (function_definition declarator: (function_declarator declarator: (identifier) @name)) @function
            (class_specifier name: (type_identifier) @name) @class
        "#,
        Language::Ruby => r#"
            (method name: (identifier) @name) @function
            (class name: (constant) @name) @class
            (module name: (constant) @name) @class
        "#,
        Language::Php => r#"
            (function_definition name: (name) @name) @function
            (method_declaration name: (name) @name) @method
            (class_declaration name: (name) @name) @class
        "#,
        Language::Unknown => return vec![],
    };

    let ts_lang = get_ts_language(lang);
    let Ok(query) = Query::new(ts_lang, query_str) else { return vec![] };
    let mut cursor = QueryCursor::new();
    let mut symbols = Vec::new();

    for m in cursor.matches(&query, root, source.as_bytes()) {
        let mut name = String::new();
        let mut kind = String::new();
        let mut node_range = (0, 0);
        let mut outer_node: Option<Node> = None;

        for capture in m.captures {
            let cap_name = query.capture_names()[capture.index as usize].as_str();
            let n = capture.node;
            if cap_name == "name" {
                if let Ok(t) = n.utf8_text(source.as_bytes()) { name = t.to_string(); }
            } else {
                kind = cap_name.to_string();
                node_range = (n.start_position().row + 1, n.end_position().row + 1);
                outer_node = Some(n);
            }
        }

        if name.is_empty() || kind.is_empty() { continue; }

        let sig = outer_node.and_then(|n| {
            let start = n.start_byte();
            let end = std::cmp::min(start + 200, n.end_byte());
            let snippet = &source[start..end];
            snippet.lines().next().map(|l| l.to_string())
        });

        let docstring = outer_node.and_then(|n| extract_docstring(n, source, lang));

        let preview = outer_node.map(|n| {
            let start = n.start_byte();
            let end = std::cmp::min(start + 80, n.end_byte());
            source[start..end].lines().next().unwrap_or("").to_string()
        }).unwrap_or_default();

        symbols.push(Symbol { name, kind, range: node_range, content_preview: preview, docstring, signature: sig });
    }

    symbols
}
