package com.aqin.mynotes.lab.l01sqli;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Each attack is run against both endpoints: it must succeed on /vuln and fail on /secure.
 */
@SpringBootTest
@AutoConfigureMockMvc
class SqlInjectionTests {

    private static final String ALICE = "1";
    private static final String OR_TRUE = "' OR 1=1 --";
    private static final String UNION_USERS = "' UNION SELECT id, id, username, password FROM users --";

    @Autowired
    MockMvc mvc;

    @Test
    void normalSearchOnlyReturnsOwnNotes() throws Exception {
        for (String base : new String[]{"/vuln", "/secure"}) {
            mvc.perform(get(base + "/l01/notes/search").header("X-User-Id", ALICE).param("keyword", "todo"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$", hasSize(1)))
                    .andExpect(jsonPath("$[0].title").value("alice todo"));
        }
    }

    @Test
    void orTrueLeaksEveryonesNotesOnVuln() throws Exception {
        mvc.perform(get("/vuln/l01/notes/search").header("X-User-Id", ALICE).param("keyword", OR_TRUE))
                .andExpect(jsonPath("$[*].title", hasItem("admin secrets")));

        mvc.perform(get("/secure/l01/notes/search").header("X-User-Id", ALICE).param("keyword", OR_TRUE))
                .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void unionDumpsPasswordsOnVuln() throws Exception {
        mvc.perform(get("/vuln/l01/notes/search").header("X-User-Id", ALICE).param("keyword", UNION_USERS))
                .andExpect(jsonPath("$[*].content", hasItem("S3cret!")));

        mvc.perform(get("/secure/l01/notes/search").header("X-User-Id", ALICE).param("keyword", UNION_USERS))
                .andExpect(jsonPath("$[*].content", not(hasItem("S3cret!"))));
    }

    @Test
    void likeWildcardIsTreatedLiterallyOnSecure() throws Exception {
        mvc.perform(get("/secure/l01/notes/search").header("X-User-Id", ALICE).param("keyword", "%"))
                .andExpect(jsonPath("$", hasSize(0)));
    }
}
