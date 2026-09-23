package com.aqin.mynotes.study;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Plain-file storage for the study site, so notes and progress live in git instead of the in-memory lab database.
 * <pre>
 * study/progress.tsv   itemId  TAB  yyyy-MM-dd
 * study/log.tsv        date TAB minutes TAB topicId TAB text
 * study/notes/{id}.md
 * </pre>
 */
@Component
public class StudyStore {

    // Ids end up in file names: whitelist them so "../" can never reach the file system (see Lab 06).
    private static final Pattern NOTE_ID = Pattern.compile("[a-z0-9][a-z0-9-]{0,63}");
    private static final Pattern ITEM_ID = Pattern.compile("[a-z0-9][a-z0-9:.-]{0,99}");

    private final Path root;
    private final Path notesDir;
    private final Path progressFile;
    private final Path logFile;

    public StudyStore(@Value("${mynotes.study.dir:study}") Path root) {
        this.root = root.toAbsolutePath().normalize();
        this.notesDir = this.root.resolve("notes");
        this.progressFile = this.root.resolve("progress.tsv");
        this.logFile = this.root.resolve("log.tsv");
        try {
            Files.createDirectories(notesDir);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public Path root() {
        return root;
    }

    // ---- progress ----

    public synchronized Map<String, String> progress() {
        Map<String, String> done = new TreeMap<>();
        for (String line : readLines(progressFile)) {
            String[] cols = line.split("\t", 2);
            if (cols.length == 2) {
                done.put(cols[0], cols[1]);
            }
        }
        return done;
    }

    public synchronized Map<String, String> setDone(String itemId, boolean done) {
        check(ITEM_ID, itemId);
        Map<String, String> progress = progress();
        if (done) {
            progress.putIfAbsent(itemId, LocalDate.now().toString());
        } else {
            progress.remove(itemId);
        }
        List<String> lines = new ArrayList<>();
        progress.forEach((id, date) -> lines.add(id + "\t" + date));
        writeLines(progressFile, lines);
        return progress;
    }

    // ---- study log ----

    public record LogEntry(int index, LocalDate date, int minutes, String topicId, String text) {
    }

    public synchronized List<LogEntry> log() {
        List<LogEntry> entries = new ArrayList<>();
        List<String> lines = readLines(logFile);
        for (int i = 0; i < lines.size(); i++) {
            String[] cols = lines.get(i).split("\t", 4);
            if (cols.length == 4) {
                entries.add(new LogEntry(i, LocalDate.parse(cols[0]), Integer.parseInt(cols[1]), cols[2], cols[3]));
            }
        }
        return entries;
    }

    public synchronized LogEntry addLog(LocalDate date, int minutes, String topicId, String text) {
        if (date == null || minutes <= 0 || minutes > 24 * 60) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "date required, minutes must be 1..1440");
        }
        String topic = topicId == null || topicId.isBlank() ? "-" : check(NOTE_ID, topicId);
        String clean = text == null ? "" : text.replaceAll("[\\t\\r\\n]+", " ").strip();
        List<String> lines = readLines(logFile);
        lines.add(date + "\t" + minutes + "\t" + topic + "\t" + clean);
        writeLines(logFile, lines);
        return new LogEntry(lines.size() - 1, date, minutes, topic, clean);
    }

    public synchronized void deleteLog(int index) {
        List<String> lines = readLines(logFile);
        if (index < 0 || index >= lines.size()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        lines.remove(index);
        writeLines(logFile, lines);
    }

    // ---- notes ----

    public record NoteSummary(String id, Instant updatedAt, int length, String excerpt) {
    }

    public record NoteFile(String id, Instant updatedAt, String content) {
    }

    public List<NoteSummary> notes() {
        try (Stream<Path> files = Files.list(notesDir)) {
            return files.filter(p -> p.getFileName().toString().endsWith(".md"))
                    .map(p -> {
                        String id = p.getFileName().toString().replaceFirst("\\.md$", "");
                        String content = read(p);
                        String excerpt = content.strip().lines().findFirst().orElse("");
                        return new NoteSummary(id, modified(p), content.length(),
                                excerpt.length() > 80 ? excerpt.substring(0, 80) + "…" : excerpt);
                    })
                    .sorted(Comparator.comparing(NoteSummary::updatedAt).reversed())
                    .toList();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public Optional<NoteFile> note(String id) {
        Path file = noteFile(id);
        return Files.exists(file) ? Optional.of(new NoteFile(id, modified(file), read(file))) : Optional.empty();
    }

    public NoteFile saveNote(String id, String content) {
        Path file = noteFile(id);
        try {
            Files.writeString(file, content == null ? "" : content, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return new NoteFile(id, modified(file), content);
    }

    public void deleteNote(String id) {
        try {
            Files.deleteIfExists(noteFile(id));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private Path noteFile(String id) {
        return notesDir.resolve(check(NOTE_ID, id) + ".md");
    }

    // ---- helpers ----

    private static String check(Pattern pattern, String id) {
        if (id == null || !pattern.matcher(id).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid id");
        }
        return id;
    }

    private static List<String> readLines(Path file) {
        if (!Files.exists(file)) {
            return new ArrayList<>();
        }
        try {
            return new ArrayList<>(Files.readAllLines(file, StandardCharsets.UTF_8).stream()
                    .filter(l -> !l.isBlank()).toList());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static void writeLines(Path file, List<String> lines) {
        try {
            Files.write(file, lines, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static String read(Path file) {
        try {
            return Files.readString(file, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static Instant modified(Path file) {
        try {
            return Files.getLastModifiedTime(file).toInstant();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
