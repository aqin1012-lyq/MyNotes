package com.aqin.mynotes.lab.l04idor;

import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class AccessControlTests {

    private static final String ALICE = "1";
    private static final String ADMIN = "3";
    private static final long ADMIN_SECRET_NOTE = 4;

    @Autowired
    MockMvc mvc;

    // ---- attacks against /vuln: these pass today ----

    @Test
    void aliceReadsAdminNoteOnVuln() throws Exception {
        mvc.perform(get("/vuln/l04/notes/{id}", ADMIN_SECRET_NOTE).header("X-User-Id", ALICE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("prod db password: hunter2"));
    }

    @Test
    void aliceListsUsersWithPasswordsOnVuln() throws Exception {
        mvc.perform(get("/vuln/l04/admin/users").header("X-User-Id", ALICE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].PASSWORD", hasItem("S3cret!")));
    }

    // ---- expected behaviour of /secure: remove @Disabled once you've implemented it ----

    @Test
    @Disabled("Lab 04 练习：实现 SecureAccessController 后删掉这行")
    void aliceReadsOwnNoteOnSecure() throws Exception {
        mvc.perform(get("/secure/l04/notes/{id}", 1).header("X-User-Id", ALICE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("alice shopping"));
    }

    @Test
    @Disabled("Lab 04 练习：实现 SecureAccessController 后删掉这行")
    void aliceCannotReadAdminNoteOnSecure() throws Exception {
        // 404 rather than 403 — see question 2 in docs/labs/04-access-control.md
        mvc.perform(get("/secure/l04/notes/{id}", ADMIN_SECRET_NOTE).header("X-User-Id", ALICE))
                .andExpect(status().isNotFound());
    }

    @Test
    @Disabled("Lab 04 练习：实现 SecureAccessController 后删掉这行")
    void aliceCannotListUsersOnSecure() throws Exception {
        mvc.perform(get("/secure/l04/admin/users").header("X-User-Id", ALICE))
                .andExpect(status().isForbidden());
    }

    @Test
    @Disabled("Lab 04 练习：实现 SecureAccessController 后删掉这行")
    void adminListsUsersWithoutPasswordsOnSecure() throws Exception {
        mvc.perform(get("/secure/l04/admin/users").header("X-User-Id", ADMIN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].username", hasItem("alice")))
                .andExpect(jsonPath("$[0].password").doesNotExist())
                .andExpect(jsonPath("$[0].PASSWORD").doesNotExist());
    }
}
