package com.aqin.mynotes.lab.l01sqli;

import com.aqin.mynotes.note.Note;
import org.springframework.jdbc.core.DataClassRowMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Lab 01 - SQL Injection (FIXED).
 */
@RestController
public class SecureNoteSearchController {

    private final JdbcTemplate jdbc;

    public SecureNoteSearchController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/secure/l01/notes/search")
    public List<Note> search(@RequestHeader("X-User-Id") long userId, @RequestParam String keyword) {
        // Bind parameters: the driver sends keyword as data, never as SQL.
        // Also escape LIKE wildcards so "%" or "_" in input can't widen the match.
        String escaped = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        String sql = "SELECT id, owner_id, title, content FROM notes"
                + " WHERE owner_id = ? AND title LIKE ? ESCAPE '\\'";
        return jdbc.query(sql, new DataClassRowMapper<>(Note.class), userId, "%" + escaped + "%");
    }
}
