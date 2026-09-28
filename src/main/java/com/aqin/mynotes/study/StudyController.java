package com.aqin.mynotes.study;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * JSON API behind the study site (static/index.html).
 */
@RestController
@RequestMapping("/api/study")
public class StudyController {

    public record DoneRequest(boolean done) {
    }

    public record LogRequest(LocalDate date, int minutes, String topicId, String text) {
    }

    public record NoteRequest(String content) {
    }

    public record AttemptRequest(String slug, String result) {
    }

    public record RenameRequest(String newId) {
    }

    private final StudyStore store;

    public StudyController(StudyStore store) {
        this.store = store;
    }

    @GetMapping("/progress")
    public Map<String, String> progress() {
        return store.progress();
    }

    @PutMapping("/progress/{itemId}")
    public Map<String, String> setDone(@PathVariable String itemId, @RequestBody DoneRequest request) {
        return store.setDone(itemId, request.done());
    }

    @GetMapping("/log")
    public List<StudyStore.LogEntry> log() {
        return store.log();
    }

    @PostMapping("/log")
    public StudyStore.LogEntry addLog(@RequestBody LogRequest request) {
        return store.addLog(request.date(), request.minutes(), request.topicId(), request.text());
    }

    @DeleteMapping("/log/{index}")
    public void deleteLog(@PathVariable int index) {
        store.deleteLog(index);
    }

    @GetMapping("/algo")
    public List<StudyStore.Attempt> attempts() {
        return store.attempts();
    }

    @PostMapping("/algo")
    public StudyStore.Attempt addAttempt(@RequestBody AttemptRequest request) {
        return store.addAttempt(request.slug(), request.result());
    }

    @DeleteMapping("/algo/{index}")
    public void deleteAttempt(@PathVariable int index) {
        store.deleteAttempt(index);
    }

    @GetMapping("/notes")
    public List<StudyStore.NoteSummary> notes(@RequestParam(required = false) String q) {
        return store.notes(q);
    }

    @GetMapping("/notes/{id}")
    public StudyStore.NoteFile note(@PathVariable String id) {
        return store.note(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    @PutMapping("/notes/{id}")
    public StudyStore.NoteFile saveNote(@PathVariable String id, @RequestBody NoteRequest request) {
        return store.saveNote(id, request.content());
    }

    @PostMapping("/notes/{id}/rename")
    public StudyStore.NoteFile renameNote(@PathVariable String id, @RequestBody RenameRequest request) {
        return store.renameNote(id, request.newId());
    }

    @DeleteMapping("/notes/{id}")
    public void deleteNote(@PathVariable String id) {
        store.deleteNote(id);
    }
}
