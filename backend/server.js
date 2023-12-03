
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(cors({
  origin: 'http://localhost:3001',
}));

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

connection.connect((err) => {
  if (err) {
    console.error('Error connecting to the database:', err);
    return;
  }
  console.log('Connected to the database!');
});

const timetable = {
  weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  subjects: ["9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM"],
  schedule: {
    "9:00 AM": [[], [], [], [], [], []],
    "10:00 AM": [[], [], [], [], [], []],
    "11:00 AM": [[], [], [], [], [], []],
    "12:00 PM": [[], [], [], [], [], []],
    "1:00 PM": [[], [], [], [], [], []],
    "2:00 PM": [[], [], [], [], [], []],
  },
};

app.get('/', (req, res) => {
  res.send('Welcome to the timetable app!');
});

app.get('/api/schedule', (req, res) => {
  const { year, section } = req.query;

  const query = `
    SELECT * FROM data 
    WHERE Year = ? AND Section = ?`;

  connection.query(query, [year, section], (err, results) => {
    if (err) {
      console.error('Error executing database query:', err);
      res.status(500).json({ error: 'Internal Server Error' });
      return;
    }
console.log("Query executed");
    const subjects = [...new Set(results.map((row) => row.Subjects))];
    const professors = [...new Set(results.map((row) => row.Professor))];
    const nos = results.map((row) => row.Nos);

    const timetableData = {
      weekdays: timetable.weekdays,
      subjects,
      professors,
      nos,
    };

    res.json(timetableData);
  });
});

app.post('/api/schedule', (req, res) => {
  const { year, section, professor, subject, day, timing } = req.body;

  console.log('/api/schedule route handler');
  console.log('Request Body:', req.body);

  // Update the data in the 'data2' cell of the particular timing row and subject column
  const timingIndex = timetable.subjects.indexOf(timing);
  const subjectIndex = timetable.weekdays.indexOf(day);

  if (timingIndex !== -1 && subjectIndex !== -1) {
    // Remove previous data from the cell
    const previousData = timetable.schedule[timing][subjectIndex][timingIndex];
    if (previousData) {
      const { year: prevYear, section: prevSection, professor: prevProfessor, subject: prevSubject } = previousData;
      const deleteQuery = `UPDATE data2 SET ${day} = NULL WHERE timings = ? AND ${day} = ?`;

      connection.query(deleteQuery, [timing, JSON.stringify(previousData)], (deleteError, deleteResults) => {
        if (deleteError) {
          console.error('Error deleting previous data from data2 table:', deleteError);
          res.status(500).json({ success: false, error: 'Failed to delete previous data', details: deleteError });
          return;
        }
        console.log('Previous data deleted successfully');
        updateTimetable(res, timing, subjectIndex, timingIndex, year, section, professor, subject, day);
      });
    } else {
      updateTimetable(res, timing, subjectIndex, timingIndex, year, section, professor, subject, day);
    }
  } else {
    console.error('Invalid timing or subject');
    res.status(400).json({ success: false, error: 'Invalid timing or subject' });
  }
});

function updateTimetable(res, timing, subjectIndex, timingIndex, year, section, professor, subject, day) {
  const data = { year, section, professor, subject };
  timetable.schedule[timing][subjectIndex][timingIndex] = data;

  // Update the 'data2' table in the database
  const updateQuery = `UPDATE data2 SET ${day} = ? WHERE timings = ?`;

  console.log('Update query:', updateQuery);

  connection.query(updateQuery, [JSON.stringify(data), timing], (updateError, results) => {
    if (updateError) {
      console.error('Error updating data2 table:', updateError);
      res.status(500).json({ success: false, error: 'Failed to update data2 table', details: updateError });
    } else if (results.affectedRows === 0) {
      console.error('Error updating timetable data: No rows updated');
      res.status(400).json({ success: false, error: 'Invalid timing or subject' });
    } else {
      console.log('Data2 table updated successfully');

      // Update the faculty table with the allocated subject
      // Check if the professor exists in the faculty table
      const professorQuery = 'SELECT * FROM faculty WHERE Professor = ?';

      connection.query(professorQuery, [professor], (professorError, professorResults) => {
        if (professorError) {
          console.error('Error selecting data from faculty table:', professorError);
          res.status(500).json({ success: false, error: 'Internal Server Error' });
          return;
        }

        if (professorResults && professorResults.length > 0) {
          // Professor exists, check if the slot is already allocated
          const allocatedSubject = professorResults[0][`${day}${timingIndex + 1}`];
          if (allocatedSubject && allocatedSubject !== '') {
            console.error('Slot already allocated');
            res.status(400).json({ success: false, error: 'Slot already allocated' });
          } else {
            // Update the subject in the faculty table
            const facultyUpdateQuery = `UPDATE faculty SET ${day}${timingIndex + 1} = ? WHERE Professor = ?`;

            connection.query(
              facultyUpdateQuery,
              [`${subject} - Year: ${year} - Section: ${section}`, professor],
              (updateError, updateResults) => {
                if (updateError) {
                  console.error('Error updating faculty table:', updateError);
                  res.status(500).json({ success: false, error: 'Internal Server Error' });
                } else {
                  console.log('Faculty table updated successfully');
                  res.status(200).json({ success: true, message: 'Faculty table updated successfully' });
                }
              }
            );
          }
        } else {
          // Professor doesn't exist, insert a new row and update the subject
          const facultyInsertQuery = `INSERT INTO faculty (Professor, ${day}${timingIndex + 1}) VALUES (?, ?)`;

          connection.query(
            facultyInsertQuery,
            [professor, `${subject} - Year: ${year} - Section: ${section}`],
            (insertError, insertResults) => {
              if (insertError) {
                console.error('Error inserting data into faculty table:', insertError);
                res.status(500).json({ success: false, error: 'Internal Server Error' });
              } else {
                console.log('Faculty table updated successfully');
                res.status(200).json({ success: true, message: 'Faculty table updated successfully' });
              }
            }
          );
        }
      });
    }
  }).on('error', (queryError) => {
    console.error('Error executing database query:', queryError);
    res.status(500).json({ success: false, error: 'Internal Server Error', details: queryError });
  });
}
app.get('/api/faculty', (req, res) => {
  const { day, timingIndex, professor } = req.query;
  const column = `${day}${Number(timingIndex )+ 1}`;

  const facultyQuery = `SELECT ${column} AS allocatedSubject FROM faculty WHERE Professor = ?`;

  connection.query(facultyQuery, [professor], (err, results) => {
    if (err) {
      console.error('Error executing database query:', err);
      res.status(500).json({ error: 'Internal Server Error' });
      return;
    }

    if (results && results.length > 0) {
      const allocatedSubject = results[0].allocatedSubject;
      res.json({ allocatedSubject: allocatedSubject ? allocatedSubject : null });
    } else {
      res.json({ allocatedSubject: null });
    }
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});



