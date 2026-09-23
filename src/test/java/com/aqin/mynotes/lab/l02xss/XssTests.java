package com.aqin.mynotes.lab.l02xss;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class XssTests {

    private static final String BOB = "2";
    private static final String PAYLOAD = "<img src=x onerror=alert(document.cookie)>";
    private static final String ESCAPED = "&lt;img src=x onerror=alert(document.cookie)&gt;";

    @Autowired
    MockMvc mvc;

    @Test
    void storedXssFiresOnVulnReviewPage() throws Exception {
        mvc.perform(post("/vuln/l02/notes").header("X-User-Id", BOB).param("title", PAYLOAD))
                .andExpect(status().isOk());

        mvc.perform(get("/vuln/l02/review"))
                .andExpect(content().string(containsString(PAYLOAD)));
        mvc.perform(get("/secure/l02/review"))
                .andExpect(content().string(not(containsString(PAYLOAD))))
                .andExpect(content().string(containsString(ESCAPED)));
    }

    @Test
    void reflectedXssFiresOnVulnSearch() throws Exception {
        mvc.perform(get("/vuln/l02/search").param("q", PAYLOAD))
                .andExpect(content().string(containsString(PAYLOAD)));
        mvc.perform(get("/secure/l02/search").param("q", PAYLOAD))
                .andExpect(content().string(not(containsString(PAYLOAD))))
                .andExpect(content().string(containsString(ESCAPED)));
    }

    @Test
    void secureResponsesCarryCsp() throws Exception {
        mvc.perform(get("/secure/l02/search").param("q", "x"))
                .andExpect(header().string("Content-Security-Policy", SecureXssController.CSP))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));
        mvc.perform(get("/vuln/l02/search").param("q", "x"))
                .andExpect(header().doesNotExist("Content-Security-Policy"));
    }
}
