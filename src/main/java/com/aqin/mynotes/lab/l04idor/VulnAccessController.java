package com.aqin.mynotes.lab.l04idor;

import com.aqin.mynotes.note.Note;
import com.aqin.mynotes.note.NoteRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Lab 04 - Broken access control (VULNERABLE, do not copy).
 */
@RestController
public class VulnAccessController {

    private final NoteRepository notes;
    private final JdbcTemplate jdbc;

    public VulnAccessController(NoteRepository notes, JdbcTemplate jdbc) {
        this.notes = notes;
        this.jdbc = jdbc;
    }

    /** Horizontal: any logged-in user can read any note by guessing its id. */
    @GetMapping("/vuln/l04/notes/{id}")
    public ResponseEntity<Note> get(@RequestHeader("X-User-Id") long userId, @PathVariable long id) {
        // BUG: userId is never compared with the note's owner
        return ResponseEntity.of(notes.findById(id));
    }

    /** Vertical: an admin-only endpoint with no role check, returning more than it should. */
    @GetMapping("/vuln/l04/admin/users")
    public List<Map<String, Object>> listUsers(@RequestHeader("X-User-Id") long userId) {
        // BUG: no role check, and SELECT * leaks the password column
        return jdbc.queryForList("SELECT * FROM users");
    }
}
