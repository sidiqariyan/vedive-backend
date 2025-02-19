const express = require('express');
const bcrypt = require('bcryptjs');
const app = express();
const port = 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Store users' data (for example purposes)
let users = [];

// Route to register a user
app.post('/register', async (req, res) => {
    const username = "ariyan";
    const password = "8460269As";
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Store the username and hashed password
    users.push({ username, password: hashedPassword });

    res.send('User registered successfully');
});

// Route to check the password
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    // Find the user in the "database"
    const user = users.find(user => user.username === username);
    
    if (!user) {
        return res.status(400).send('User not found');
    }

    // Compare the password with the stored hashed password
    const isMatch = await bcrypt.compare(password, user.password);

    if (isMatch) {
        res.send('Login successful');
    } else {
        res.status(400).send('Incorrect password');
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
