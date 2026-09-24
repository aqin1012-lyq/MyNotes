package com.aqin.mynotes.study;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Every topic in curriculum.js must ship a lesson the site can render (static/lessons/{id}.md).
 */
class LessonsTests {

    private static final Path STATIC = Path.of("src/main/resources/static");
    // topic entries look like: id: 'net-tcp', title: '...', month: '2026-10'
    private static final Pattern TOPIC = Pattern.compile("id: '([a-z0-9-]+)', title: '[^']*', month:");

    @Test
    void everyTopicHasAWellFormedLesson() throws IOException {
        String curriculum = Files.readString(STATIC.resolve("curriculum.js"), StandardCharsets.UTF_8);
        List<String> ids = new ArrayList<>();
        Matcher m = TOPIC.matcher(curriculum);
        while (m.find()) {
            ids.add(m.group(1));
        }
        assertThat(ids).hasSizeGreaterThan(40);

        List<String> problems = new ArrayList<>();
        for (String id : ids) {
            Path lesson = STATIC.resolve("lessons/" + id + ".md");
            if (!Files.exists(lesson)) {
                problems.add(id + ": missing");
                continue;
            }
            String md = Files.readString(lesson, StandardCharsets.UTF_8);
            if (md.strip().startsWith("# ")) {
                problems.add(id + ": starts with an H1 (the page already shows the title)");
            }
            if (!md.contains("## 自测") || !md.contains(":::details")) {
                problems.add(id + ": no self-check section");
            }
            long opened = md.lines().filter(l -> l.startsWith(":::") && !l.strip().equals(":::")).count();
            long closed = md.lines().filter(l -> l.strip().equals(":::")).count();
            if (opened != closed) {
                problems.add(id + ": " + opened + " ::: containers opened but " + closed + " closed");
            }
            if (md.lines().filter(l -> l.startsWith("```")).count() % 2 != 0) {
                problems.add(id + ": unbalanced ``` code fence");
            }
        }
        assertThat(problems).isEmpty();
    }
}
