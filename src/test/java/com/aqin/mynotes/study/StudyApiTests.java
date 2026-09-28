package com.aqin.mynotes.study;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "mynotes.study.dir=target/study-test")
@AutoConfigureMockMvc
class StudyApiTests {

    @Autowired
    MockMvc mvc;

    @Autowired
    StudyStore store;

    @Test
    void progressCanBeCheckedAndUnchecked() throws Exception {
        mvc.perform(put("/api/study/progress/net-tcp:k0").contentType(MediaType.APPLICATION_JSON).content("{\"done\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$['net-tcp:k0']").exists());
        mvc.perform(put("/api/study/progress/net-tcp:k0").contentType(MediaType.APPLICATION_JSON).content("{\"done\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$['net-tcp:k0']").doesNotExist());
    }

    @Test
    void noteRoundTripsAsMarkdownFile() throws Exception {
        mvc.perform(put("/api/study/notes/test-note").contentType(MediaType.APPLICATION_JSON).content("{\"content\":\"# hi\"}"))
                .andExpect(status().isOk());
        assertThat(Files.readString(store.root().resolve("notes/test-note.md"))).isEqualTo("# hi");
        mvc.perform(get("/api/study/notes/test-note")).andExpect(jsonPath("$.content").value("# hi"));
        mvc.perform(delete("/api/study/notes/test-note")).andExpect(status().isOk());
        mvc.perform(get("/api/study/notes/test-note")).andExpect(status().isNotFound());
    }

    @Test
    void noteIdCannotEscapeNotesDirectory() throws Exception {
        for (String id : new String[]{"..", "..%2F..%2Fpom", "Upper", ".hidden"}) {
            mvc.perform(put("/api/study/notes/" + id).contentType(MediaType.APPLICATION_JSON).content("{\"content\":\"x\"}"))
                    .andExpect(result -> assertThat(result.getResponse().getStatus()).isBetween(400, 404));
        }
        assertThat(Files.exists(store.root().resolve("pom.xml"))).isFalse();
    }

    @Test
    void algoAttemptsAreRecordedAndValidated() throws Exception {
        int before = store.attempts().size();
        mvc.perform(post("/api/study/algo").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slug\":\"two-sum\",\"result\":\"ac\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("two-sum"))
                .andExpect(jsonPath("$.result").value("ac"));
        assertThat(store.attempts()).hasSize(before + 1);
        mvc.perform(delete("/api/study/algo/" + before)).andExpect(status().isOk());
        assertThat(store.attempts()).hasSize(before);

        mvc.perform(post("/api/study/algo").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slug\":\"two-sum\",\"result\":\"maybe\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/study/algo").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slug\":\"../x\",\"result\":\"ac\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void logEntriesAreAppendedAndDeleted() throws Exception {
        int before = store.log().size();
        mvc.perform(post("/api/study/log").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"date\":\"2026-10-01\",\"minutes\":45,\"topicId\":\"net-dns\",\"text\":\"dig +trace\\tdone\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.text").value("dig +trace done"));
        assertThat(store.log()).hasSize(before + 1);
        mvc.perform(delete("/api/study/log/" + before)).andExpect(status().isOk());
        assertThat(store.log()).hasSize(before);

        mvc.perform(post("/api/study/log").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"date\":\"2026-10-01\",\"minutes\":0}"))
                .andExpect(status().isBadRequest());
    }
}
