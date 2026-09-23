package com.aqin.mynotes.note;

public record Note(Long id, Long ownerId, String title, String content) {
}
