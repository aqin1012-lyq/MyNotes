DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id       BIGINT PRIMARY KEY,
    username VARCHAR(64)  NOT NULL UNIQUE,
    password VARCHAR(128) NOT NULL, -- plaintext on purpose; hashing is a later lab
    role     VARCHAR(16)  NOT NULL
);

CREATE TABLE notes (
    id       BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner_id BIGINT       NOT NULL REFERENCES users (id),
    title    VARCHAR(255) NOT NULL,
    content  VARCHAR(4000)
);
