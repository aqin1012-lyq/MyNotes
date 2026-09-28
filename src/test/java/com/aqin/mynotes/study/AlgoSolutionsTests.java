package com.aqin.mynotes.study;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Every problem in algo.js ships a solution page (static/algo/{slug}.md) whose Java code actually compiles,
 * against LeetCode-style ListNode / TreeNode / Node classes.
 */
class AlgoSolutionsTests {

    private static final Path STATIC = Path.of("src/main/resources/static");
    private static final Pattern PROBLEM = Pattern.compile("\\[\\d+, '([a-z0-9-]+)', '");
    private static final Pattern JAVA_BLOCK = Pattern.compile("(?m)^```java\\s*\\n(.*?)^```", Pattern.DOTALL);

    private static final String STUBS = """
            class ListNode {
                int val; ListNode next;
                ListNode() {} ListNode(int val) { this.val = val; } ListNode(int val, ListNode next) { this.val = val; this.next = next; }
            }
            class TreeNode {
                int val; TreeNode left, right;
                TreeNode() {} TreeNode(int val) { this.val = val; }
                TreeNode(int val, TreeNode left, TreeNode right) { this.val = val; this.left = left; this.right = right; }
            }
            class Node {
                int val; Node next, random;
                Node(int val) { this.val = val; }
            }
            """;

    @Test
    void everyProblemHasACompilingSolution(@TempDir Path out) throws IOException {
        String algo = Files.readString(STATIC.resolve("algo.js"), StandardCharsets.UTF_8);
        List<String> slugs = new ArrayList<>();
        Matcher m = PROBLEM.matcher(algo);
        while (m.find()) {
            slugs.add(m.group(1));
        }
        assertThat(slugs).hasSize(100);

        JavaCompiler javac = ToolProvider.getSystemJavaCompiler();
        List<String> problems = new ArrayList<>();
        for (String slug : slugs) {
            Path page = STATIC.resolve("algo/" + slug + ".md");
            if (!Files.exists(page)) {
                problems.add(slug + ": missing");
                continue;
            }
            String md = Files.readString(page, StandardCharsets.UTF_8);
            for (String heading : List.of("## 题意", "## 思路", "## Java 题解", "## 复杂度")) {
                if (!md.contains(heading)) {
                    problems.add(slug + ": no '" + heading + "'");
                }
            }
            if (md.lines().filter(l -> l.startsWith("```")).count() % 2 != 0) {
                problems.add(slug + ": unbalanced ``` fence");
            }
            Matcher code = JAVA_BLOCK.matcher(md);
            int n = 0;
            while (code.find()) {
                String error = compile(javac, out.resolve(slug + "-" + n++), code.group(1));
                if (error != null) {
                    problems.add(slug + " (java block " + n + "): " + error);
                }
            }
            if (n == 0) {
                problems.add(slug + ": no java block");
            }
        }
        assertThat(problems).isEmpty();
    }

    /** Compiles one code block plus the stubs; returns the first error, or null. */
    private static String compile(JavaCompiler javac, Path out, String code) throws IOException {
        Files.createDirectories(out);
        // imports must come first, so the stubs go into their own compilation unit
        List<JavaFileObject> units = List.of(source("Stubs", STUBS), source("Solution", code));
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        try (StandardJavaFileManager files = javac.getStandardFileManager(diagnostics, null, StandardCharsets.UTF_8)) {
            boolean ok = javac.getTask(null, files, diagnostics,
                    List.of("-d", out.toString(), "-proc:none", "-Xlint:none", "-nowarn"), null, units).call();
            if (ok) {
                return null;
            }
        }
        return diagnostics.getDiagnostics().stream()
                .filter(d -> d.getKind() == javax.tools.Diagnostic.Kind.ERROR)
                .map(d -> "line " + d.getLineNumber() + ": " + d.getMessage(null))
                .findFirst().orElse("compilation failed");
    }

    private static JavaFileObject source(String name, String code) {
        return new SimpleJavaFileObject(URI.create("string:///" + name + ".java"), JavaFileObject.Kind.SOURCE) {
            @Override
            public CharSequence getCharContent(boolean ignoreEncodingErrors) {
                return code;
            }
        };
    }
}
