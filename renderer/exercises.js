// CodeClue built-in missions — the BlueJ-style pedagogy layer.
// Each mission: starter program, a 3-clue chain, and a validator that checks
// the RUN OUTPUT (never just the text of the code).

'use strict';

/* -------------------------- validator helpers -------------------------- */

function printedValues(stdoutArr) {
  return stdoutArr
    .map((l) => String(l).trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^-?\d+(\.\d+)?$/.exec(l);
      return m ? (Number.isInteger(Number(l)) ? String(Number(l)) : l.replace(/\.0+$/, '')) : l;
    });
}

function exactLines(stdoutArr, expected) {
  const got = printedValues(stdoutArr);
  if (got.length !== expected.length) {
    return { ok: false, msg: `Expected ${expected.length} printed line(s), saw ${got.length}. Print exactly one value per line — nothing extra.` };
  }
  for (let i = 0; i < expected.length; i++) {
    if (String(expected[i]) !== got[i]) {
      return { ok: false, msg: `Line ${i + 1} should be "${expected[i]}" but printed "${got[i]}". Check the order you print in.` };
    }
  }
  return { ok: true, msg: '✓ Verified — the output matches the mission exactly!' };
}

function check(cond, okMsg, failMsg) {
  return cond ? { ok: true, msg: okMsg } : { ok: false, msg: failMsg };
}

/* ------------------------------- missions ------------------------------- */

const EXERCISES = [
  {
    id: 'js-loops',
    lang: 'javascript',
    title: 'Loop the Loop',
    langLabel: 'JavaScript',
    blurb: 'Print the numbers 1 through 10, one per line. One loop and a counter do all the work.',
    starter: `// MISSION: print the numbers 1 through 10, one per line.\n// Write ONE loop instead of ten print lines.\n\n`,
    hints: [
      { label: 'Clue 1 · Nudge', text: "You shouldn't write 10 print lines by hand. Is there a statement that repeats other statements for you?" },
      { label: 'Clue 2 · Concept', text: 'A for loop runs its body once per count: for (let i = START; i <= END; i++) { ... }. The variable i is the counter — first pass it holds START, then START+1, and so on until the condition fails.' },
      { label: 'Clue 3 · Shape', text: 'Fill in the missing piece:', snippet: 'for (let i = 1; i <= 10; i++) {\n  // print i here\n}' },
    ],
    validate(res) {
      return exactLines(res.stdout, [1,2,3,4,5,6,7,8,9,10]);
    },
  },
  {
    id: 'js-fizzbuzz',
    lang: 'javascript',
    title: 'FizzBuzz',
    langLabel: 'JavaScript',
    blurb: 'Print 1..15, but multiples of 3 print Fizz, multiples of 5 print Buzz, and multiples of both print FizzBuzz instead of the number.',
    starter: `// MISSION: print 1..15, but:\n//   multiple of 3 -> Fizz\n//   multiple of 5 -> Buzz\n//   multiple of both 3 AND 5 -> FizzBuzz\n//   otherwise -> the number itself\n\n`,
    hints: [
      { label: 'Clue 1 · Nudge', text: '"Multiple of 3" isn\'t spelled out in code... but there\'s an operator that gives you the remainder when dividing. What\'s 6 % 3? What\'s 7 % 3?' },
      { label: 'Clue 2 · Concept', text: 'a % b is the remainder of a ÷ b. A multiple of 3 has remainder 0, so (i % 3 === 0) means "i is a multiple of 3". Order matters: check the BOTH-case (multiple of 15) before the single cases, or the first matching if wins.' },
      { label: 'Clue 3 · Shape', text: 'Decision ladder to imitate (fill the logic yourself):', snippet: 'if (/* multiple of BOTH */) {\n  // print which word?\n} else if (/* multiple of 3 only */) {\n  // ...\n} else {\n  // nothing matched: print what?\n}' },
    ],
    validate(res) {
      const expected = [];
      for (let i = 1; i <= 15; i++) expected.push(i % 15 === 0 ? 'FizzBuzz' : i % 3 === 0 ? 'Fizz' : i % 5 === 0 ? 'Buzz' : String(i));
      return exactLines(res.stdout, expected);
    },
  },
  {
    id: 'js-even-sum',
    lang: 'javascript',
    title: 'Sum of Evens',
    langLabel: 'JavaScript',
    blurb: 'Add up every even number from 1 to 100 and print the total — too many steps to do by hand, exactly why loops and accumulators exist.',
    starter: `// MISSION: sum the even numbers 1..100, then print the total.\n// You will need two ideas working together:\n//   - a variable that collects the running total\n//   - a way to test "is this number even?"\n\n`,
    hints: [
      { label: 'Clue 1 · Nudge', text: "You can't sum without keeping the running result somewhere. Make a variable before the loop that starts at a neutral value for adding — what number changes nothing when you add it?" },
      { label: 'Clue 2 · Concept', text: 'The accumulate pattern: start a total at 0 before the loop, and inside the body do total += value for each value you want to keep. To pick only even values, the remainder test again: i % 2 === 0.' },
      { label: 'Clue 3 · Shape', text: 'Skeleton (fill the even-check and the accumulate line):', snippet: 'let total = 0;\nfor (let i = 1; i <= 100; i++) {\n  if (/* i is even */) {\n    // add i into total\n  }\n}\nprintTotal(total); // replace with a real print' },
    ],
    validate(res) {
      return exactLines(res.stdout, [2550]);
    },
  },
  {
    id: 'js-oop-roster',
    lang: 'javascript',
    title: 'Class Roster',
    langLabel: 'JavaScript',
    blurb: 'The BlueJ-flavored one: define a Student class (name + grade), then create TWO Student objects and make each one introduce itself.',
    starter: `// MISSION: BlueJ-style objects!\n//  1. Define a class Student: it takes a name and a grade,\n//     and has a method introduce() that RETURNS the string:\n//        Hi, I'm <name> and I'm in grade <grade>.\n//  2. Create two Student objects with different data.\n//  3. Print each student's introduce() result.\n\nclass Student {\n  // your fields and constructor go here\n}\n\n`,
    hints: [
      { label: 'Clue 1 · Nudge', text: 'A class is a stamp; every new Student(...) press makes a fresh object from it. Where does incoming data (name, grade) get stored on each object?' },
      { label: 'Clue 2 · Concept', text: 'constructor(name, grade) runs automatically when someone writes new Student("Ada", 12). Inside, this.name = name saves the value on THIS object. Methods like introduce() can then read this.name. new makes a separate object per call — two calls, two students, same stamp.' },
      { label: 'Clue 3 · Shape', text: 'Shape of the whole thing (fill in the definitions):', snippet: 'class Student {\n  constructor(/* params */) {\n    // save each param on this\n  }\n  introduce() {\n    return `template string using this.name and this.grade`;\n  }\n}\n\nconst s1 = new Student(/* ... */);\n// make a second student, then print both intros' },
    ],
    validate(res) {
      const out = res.stdout.join('\n');
      const introCount = (out.match(/Hi, I'm .+ and I'm in grade \d+\./g) || []).length;
      const step1 = check(/class\s+Student/.test(res.code), '✓ Class Student defined', 'Define the class first: class Student { ... }.');
      if (!step1.ok) return step1;
      const step2 = check(/new\s+Student\s*\(/.test(res.code), '✓ Objects created with new', 'The class exists — now use it: const s1 = new Student(...).');
      if (!step2.ok) return step2;
      return check(
        introCount >= 2,
        '✓ Mission complete — two students introduced themselves!',
        `Expected at least 2 lines like "Hi, I'm Ada and I'm in grade 12." — got ${introCount}. Make sure you print the returned string.`
      );
    },
  },
  {
    id: 'py-loops',
    lang: 'python',
    title: 'Loop the Loop (Python)',
    langLabel: 'Python',
    blurb: 'Same as the JS one, so you feel how differently each language says the same idea: print 1 through 10, one per line.',
    starter: `# MISSION: print the numbers 1 through 10, one per line.\n`,
    hints: [
      { label: 'Clue 1 · Nudge', text: "Python's for loop walks over a sequence. What sequence contains 1..10? Careful: the end of range() is NOT included." },
      { label: 'Clue 2 · Concept', text: 'range(a, b) counts a, a+1, ..., b-1 — quirky but everywhere in Python. So to include 10 you must ask for one more: range(1, 11).' },
      { label: 'Clue 3 · Shape', text: 'The two-part shape:', snippet: 'for i in range(START, END_PLUS_ONE):\n    print(i)' },
    ],
    validate(res) {
      return exactLines(res.stdout, [1,2,3,4,5,6,7,8,9,10]);
    },
  },
  {
    id: 'py-even-sum',
    lang: 'python',
    title: 'Sum of Evens (Python)',
    langLabel: 'Python',
    blurb: 'Sum every even number 1..100 and print the total.',
    starter: `# MISSION: sum the even numbers 1..100, print the total.\n`,
    hints: [
      { label: 'Clue 1 · Nudge', text: 'You need the same accumulate pattern as the JS mission: a total that starts neutral and grows every loop pass.' },
      { label: 'Clue 2 · Concept', text: 'In Python the % remainder operator works identically: i % 2 == 0 means even. total += i is shorthand for total = total + i.' },
      { label: 'Clue 3 · Shape', text: 'Skeleton:', snippet: 'total = 0\nfor i in range(1, 101):\n    if i % 2 == 0:\n        # add i to total\n\n# after the loop: print the total' },
    ],
    validate(res) {
      return exactLines(res.stdout, [2550]);
    },
  },
  {
    id: 'py-oop-roster',
    lang: 'python',
    title: 'Roster (Python classes)',
    langLabel: 'Python',
    blurb: 'Python-style objects: a Student class with __init__, and introductions from two objects.',
    starter: `# MISSION:\n#  1. class Student with __init__(self, name, grade)\n#  2. introduce(self) RETURNS: Hi, I'm <name> and I'm in grade <grade>.\n#  3. Make two students and print their introduce() results.\n`,
    hints: [
      { label: 'Clue 1 · Nudge', text: "Python's constructor has a special name with double underscores, and its FIRST parameter is always the object itself. What must that first parameter be called?" },
      { label: 'Clue 2 · Concept', text: 'def __init__(self, name, grade) runs on new Student(...). self.name = name stores the value on the object. Other methods receive self too, so introduce() inside can read self.name. Forget self in a def and Python complains about a surprise argument.' },
      { label: 'Clue 3 · Shape', text: 'Shape:', snippet: 'class Student:\n    def __init__(self, name, grade):\n        # store each value on self\n\n    def introduce(self):\n        return f"template using {self.name} and {self.grade}"\n\ns1 = Student(...)\n# print s1.introduce() and a second student\'s too' },
    ],
    validate(res) {
      const out = res.stdout.join('\n');
      const introCount = (out.match(/Hi, I'm .+ and I'm in grade \d+\./g) || []).length;
      const step1 = check(/class\s+Student/.test(res.code), '✓ class Student defined', 'Start with the class header: class Student:');
      if (!step1.ok) return step1;
      const step2 = check(/__init__/.test(res.code), '✓ __init__ written', 'Add the constructor: def __init__(self, name, grade):');
      if (!step2.ok) return step2;
      return check(introCount >= 2, `✓ Mission complete — two introductions!` , `Expected at least 2 lines like "Hi, I'm ... and I'm in grade ..."; got ${introCount}. Are you printing return values of introduce()?`);
    },
  },
  {
    id: 'java-loops',
    lang: 'java',
    title: 'Loop the Loop (Java)',
    langLabel: 'Java',
    blurb: 'Runs on your real JDK: print 1..10 from main(). Your first compiled language mission.',
    starter: `public class Main {\n    public static void main(String[] args) {\n        // MISSION: print the numbers 1..10, one per line\n    }\n}\n`,
    hints: [
      { label: 'Clue 1 · Nudge', text: 'In Java printing is a statement on the System class. What exact method name prints a line and moves the cursor down?' },
      { label: 'Clue 2 · Concept', text: 'System.out.println(value) prints then breaks the line (print keeps the line). The for loop syntax is the same family as JavaScript: for (int i = 1; i <= 10; i++). Java insists you declare the type: int, not let.' },
      { label: 'Clue 3 · Shape', text: 'The shape inside main:', snippet: 'for (int i = START; i <= END; i++) {\n    System.out.println(i);\n}' },
    ],
    validate(res) {
      return exactLines(res.stdout, [1,2,3,4,5,6,7,8,9,10]);
    },
  },
];
