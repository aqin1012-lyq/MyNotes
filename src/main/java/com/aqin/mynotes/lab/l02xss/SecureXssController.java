package com.aqin.mynotes.lab.l02xss;

import com.aqin.mynotes.note.Note;
import com.aqin.mynotes.note.NoteRepository;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import static org.springframework.web.util.HtmlUtils.htmlEscape;

/**
 * Lab 02 - XSS (FIXED).
 * <p>
 * Primary defence: encode on output, for the context being written into (here: HTML body).
 * Defence in depth: a CSP that forbids inline script, so a missed encoding is not automatically game over.
 */
@RestController
public class SecureXssController {

    static final String CSP = "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'";

    private final NoteRepository notes;

    public SecureXssController(NoteRepository notes) {
        this.notes = notes;
    }

    @ModelAttribute
    void securityHeaders(HttpServletResponse response) {
        response.setHeader("Content-Security-Policy", CSP);
        response.setHeader("X-Content-Type-Options", "nosniff");
    }

    @PostMapping("/secure/l02/notes")
    public void create(@RequestHeader("X-User-Id") long userId,
                       @RequestParam String title, @RequestParam(defaultValue = "") String content) {
        // Store the raw input; escaping belongs at output time, where the context is known.
        notes.insert(userId, title, content);
    }

    @GetMapping(value = "/secure/l02/review", produces = MediaType.TEXT_HTML_VALUE)
    public String review() {
        StringBuilder html = new StringBuilder("<h1>Note review</h1><ul>");
        for (Note note : notes.findAll()) {
            html.append("<li>").append(htmlEscape(note.title())).append("</li>");
        }
        return html.append("</ul>").toString();
    }

    @GetMapping(value = "/secure/l02/search", produces = MediaType.TEXT_HTML_VALUE)
    public String search(@RequestParam String q) {
        return "<p>No results for " + htmlEscape(q) + "</p>";
    }
}
