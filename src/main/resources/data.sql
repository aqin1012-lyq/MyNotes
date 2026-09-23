INSERT INTO users (id, username, password, role) VALUES
    (1, 'alice', 'alice123', 'USER'),
    (2, 'bob',   'bob123',   'USER'),
    (3, 'admin', 'S3cret!',  'ADMIN');

INSERT INTO notes (owner_id, title, content) VALUES
    (1, 'alice shopping', 'milk, eggs'),
    (1, 'alice todo',     'learn TCP/IP'),
    (2, 'bob diary',      'bob private diary'),
    (3, 'admin secrets',  'prod db password: hunter2');
