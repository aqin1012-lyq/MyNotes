package com.aqin.mynotes.note;

import org.springframework.jdbc.core.DataClassRowMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * Safe (parameterized) data access shared by the labs that aren't about SQL.
 */
@Repository
public class NoteRepository {

    private static final String COLUMNS = "SELECT id, owner_id, title, content FROM notes";

    private final JdbcTemplate jdbc;

    public NoteRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Note> findById(long id) {
        return jdbc.query(COLUMNS + " WHERE id = ?", new DataClassRowMapper<>(Note.class), id)
                .stream().findFirst();
    }

    public List<Note> findAll() {
        return jdbc.query(COLUMNS + " ORDER BY id", new DataClassRowMapper<>(Note.class));
    }

    public void insert(long ownerId, String title, String content) {
        jdbc.update("INSERT INTO notes (owner_id, title, content) VALUES (?, ?, ?)", ownerId, title, content);
    }
}
