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
 * Lab 01 - SQL Injection (VULNERABLE, do not copy).
 * <p>
 * The current user is taken from the {@code X-User-Id} header until the auth labs replace it.
 */
@RestController
public class VulnNoteSearchController {

    private final JdbcTemplate jdbc;

    public VulnNoteSearchController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/vuln/l01/notes/search")
    public List<Note> search(@RequestHeader("X-User-Id") long userId, @RequestParam String keyword) {
        // BUG: user input is concatenated straight into the SQL text
        String sql = "SELECT id, owner_id, title, content FROM notes"
                + " WHERE owner_id = " + userId
                + " AND title LIKE '%" + keyword + "%'";
        return jdbc.query(sql, new DataClassRowMapper<>(Note.class));
    }
}
