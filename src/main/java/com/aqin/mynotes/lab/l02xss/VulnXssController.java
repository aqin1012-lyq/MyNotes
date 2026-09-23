package com.aqin.mynotes.lab.l02xss;

import com.aqin.mynotes.note.Note;
import com.aqin.mynotes.note.NoteRepository;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Lab 02 - XSS (VULNERABLE, do not copy).
 * <p>
 * Stored: any user creates a note, the review page renders every title as raw HTML.
 * Reflected: the search page echoes the query back as raw HTML.
 * (Who may open the review page is Lab 04's problem, not this one's.)
 */
@RestController
public class VulnXssController {

    private final NoteRepository notes;

    public VulnXssController(NoteRepository notes) {
        this.notes = notes;
    }

    @PostMapping("/vuln/l02/notes")
    public void create(@RequestHeader("X-User-Id") long userId,
                       @RequestParam String title, @RequestParam(defaultValue = "") String content) {
        notes.insert(userId, title, content);
    }

    @GetMapping(value = "/vuln/l02/review", produces = MediaType.TEXT_HTML_VALUE)
    public String review() {
        StringBuilder html = new StringBuilder("<h1>Note review</h1><ul>");
        for (Note note : notes.findAll()) {
            // BUG: stored user input written into HTML as-is
            html.append("<li>").append(note.title()).append("</li>");
        }
        return html.append("</ul>").toString();
    }

    @GetMapping(value = "/vuln/l02/search", produces = MediaType.TEXT_HTML_VALUE)
    public String search(@RequestParam String q) {
        // BUG: request parameter reflected into HTML as-is
        return "<p>No results for " + q + "</p>";
    }
}
