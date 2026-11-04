// CodeClue lessons — the teaching layer.
// Each mission gets a real lesson: the idea in plain language, a worked
// example you can run, and a checkpoint. Hints stay separate and progressive.

'use strict';

const LESSONS = {
  /* ----------------------------- JavaScript ----------------------------- */
  'js-loops': {
    n: 1,
    idea:
      'A loop tells the computer to repeat a block of code instead of you copying it out ten times. ' +
      'A for loop has three parts: where to start, when to stop, and how to move to the next value.',
    analogy:
      'Think of a treadmill: you set the starting speed (start), you keep going while the belt is on (condition), ' +
      'and each step moves you forward (increment).',
    example: `for (let i = 1; i <= 3; i++) {
  console.log(i);
}`,
    walkthrough: [
      { code: 'for (let i = 1;', text: 'Create a counter called i and start it at 1.' },
      { code: 'i <= 3;', text: 'Keep looping while i is at most 3. When i becomes 4, the loop stops.' },
      { code: 'i++)', text: 'After each pass, add 1 to i. That is what moves the loop forward.' },
      { code: 'console.log(i);', text: 'The body: print the current value of i.' },
    ],
    expected: '1\n2\n3',
    task: 'Change the example so it prints 1 through 10, one number per line. Keep the same three parts — only the stop value changes.',
    checkpoint: 'Run it. The output should be 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 — each on its own line.',
  },

  'js-fizzbuzz': {
    n: 2,
    idea:
      'Programs make decisions with if / else if / else. Only the first matching branch runs. ' +
      'The % operator gives the remainder of a division, which is how we test "is this a multiple of N?".',
    analogy:
      'A bouncer with a checklist: check the strictest rule first (both 3 and 5), then the narrower ones, ' +
      'and only let the default case through if nothing matched.',
    example: `for (let i = 1; i <= 5; i++) {
  if (i % 2 === 0) {
    console.log("even");
  } else {
    console.log(i);
  }
}`,
    walkthrough: [
      { code: 'i % 2 === 0', text: 'Remainder when dividing by 2 is 0 → the number is even.' },
      { code: 'if (...) { ... }', text: 'If the test is true, run the first block and skip the else.' },
      { code: 'else { ... }', text: 'Otherwise run the second block. Exactly one of the two runs.' },
      { code: 'i <= 5', text: 'The loop stops after 5, so we only test a few values.' },
    ],
    expected: '1\neven\n3\neven\n5',
    task: 'Print 1 through 15. Multiples of 3 print Fizz, multiples of 5 print Buzz, multiples of both print FizzBuzz, everything else prints the number. Check the both-case first.',
    checkpoint: 'Run it. The 15 lines must match FizzBuzz exactly — order and spelling included.',
  },

  'js-even-sum': {
    n: 3,
    idea:
      'An accumulator is a variable that collects a result across loop passes. Start it at a neutral value ' +
      '(0 for addition), then update it inside the loop. After the loop, it holds the answer.',
    analogy:
      'A shopping basket: it starts empty, you add one item each trip through the store, and at the end you count what is in it.',
    example: `let total = 0;
for (let i = 1; i <= 5; i++) {
  total += i;
}
console.log(total);`,
    walkthrough: [
      { code: 'let total = 0;', text: 'Create the basket. 0 is neutral for addition.' },
      { code: 'total += i;', text: 'Add the current value into the running total each pass.' },
      { code: 'console.log(total);', text: 'Print once, AFTER the loop — not inside it.' },
    ],
    expected: '15',
    task: 'Sum every even number from 1 to 100 and print the total. Combine the accumulator with an even test (i % 2 === 0).',
    checkpoint: 'Run it. You should see a single number: 2550.',
  },

  'js-oop-roster': {
    n: 4,
    idea:
      'A class is a template. Each new object made from it gets its own copy of the data. ' +
      'The constructor stores the starting values, and methods use this to read them back.',
    analogy:
      'A class is a cookie cutter; objects are the cookies. Same shape, different icing (data) on each one.',
    example: `class Dog {
  constructor(name) {
    this.name = name;
  }
  speak() {
    return "Woof, I am " + this.name;
  }
}

const d = new Dog("Rex");
console.log(d.speak());`,
    walkthrough: [
      { code: 'class Dog {', text: 'Declare the template.' },
      { code: 'constructor(name) { this.name = name; }', text: 'Runs on new Dog(...). this.name stores the value on THIS object.' },
      { code: 'speak() { return ... }', text: 'A method can read this.name because it belongs to the same object.' },
      { code: 'new Dog("Rex")', text: 'Creates a fresh object. Call it again with another name and you get a second, independent dog.' },
    ],
    expected: 'Woof, I am Rex',
    task: 'Build a Student class with name and grade, and an introduce() method that returns "Hi, I\'m <name> and I\'m in grade <grade>.". Create two students and print both introductions.',
    checkpoint: 'Run it. You should see two lines that start with "Hi, I\'m " and end with a grade and a period.',
  },

  /* ------------------------------- Python ------------------------------- */
  'py-loops': {
    n: 5,
    idea:
      'Python loops walk over a sequence. range(a, b) produces a, a+1, … up to but NOT including b. ' +
      'That "end is excluded" rule is the number-one beginner trap.',
    analogy:
      'range(1, 11) is a fence with posts numbered 1 to 10 — the 11 is the fence after the last post, not a post itself.',
    example: `for i in range(1, 4):
    print(i)`,
    walkthrough: [
      { code: 'for i in range(1, 4):', text: 'i takes the values 1, 2, 3. The 4 is the stopping line, not included.' },
      { code: '    print(i)', text: 'The indented body runs once per value. Indentation is the block.' },
    ],
    expected: '1\n2\n3',
    task: 'Print 1 through 10 in Python. Ask yourself: what second number do you pass to range so that 10 is included?',
    checkpoint: 'Run it. The output must be exactly 1 through 10, one per line.',
  },

  'py-even-sum': {
    n: 6,
    idea:
      'Python accumulators work exactly like JavaScript ones: a total starts at 0, grows inside the loop, ' +
      'and is printed after the loop. total += i is shorthand for total = total + i.',
    analogy:
      'Same basket idea as before, just a different language spelling.',
    example: `total = 0
for i in range(1, 6):
    total += i
print(total)`,
    walkthrough: [
      { code: 'total = 0', text: 'Start the basket empty.' },
      { code: 'total += i', text: 'Add each value as the loop visits it.' },
      { code: 'print(total)', text: 'No indentation → this runs once, after the loop.' },
    ],
    expected: '15',
    task: 'Sum every even number from 1 to 100 in Python and print the total.',
    checkpoint: 'Run it. Expect one line: 2550.',
  },

  'py-oop-roster': {
    n: 7,
    idea:
      'Python classes use __init__ as the constructor. The first parameter is always self — the object being built. ' +
      'Storing self.name = name gives each object its own data.',
    analogy:
      'self is the word "me". When a method says self.name it means "my name", not anyone else\'s.',
    example: `class Dog:
    def __init__(self, name):
        self.name = name

    def speak(self):
        return f"Woof, I am {self.name}"

d = Dog("Rex")
print(d.speak())`,
    walkthrough: [
      { code: 'def __init__(self, name):', text: 'Runs when you write Dog("Rex"). self is the new object.' },
      { code: 'self.name = name', text: 'Attach the value to this object.' },
      { code: 'def speak(self):', text: 'Every method takes self first, so it can read the stored data.' },
      { code: 'f"...{self.name}"', text: 'An f-string drops values straight into the text.' },
    ],
    expected: 'Woof, I am Rex',
    task: 'Make a Student class with __init__(self, name, grade) and introduce(self) returning the introduction line. Create two students and print both results.',
    checkpoint: 'Run it. Two introduction lines, each with a real name and grade.',
  },

  /* -------------------------------- Java -------------------------------- */
  'java-loops': {
    n: 8,
    idea:
      'Java is compiled: the whole program is checked before anything runs, so every variable needs a type. ' +
      'The loop shape is the same family as JavaScript, but the counter is declared as int, not let.',
    analogy:
      'Compiling is like a proofreader reading the entire essay before it is published. JavaScript skims as it goes; Java checks first.',
    example: `public class Main {
    public static void main(String[] args) {
        for (int i = 1; i <= 3; i++) {
            System.out.println(i);
        }
    }
}`,
    walkthrough: [
      { code: 'public class Main {', text: 'The file must contain a class whose name matches the file.' },
      { code: 'public static void main(String[] args)', text: 'The entry point. Java starts running here.' },
      { code: 'int i = 1', text: 'Unlike let, Java needs the type spelled out.' },
      { code: 'System.out.println(i);', text: 'Print a line. print() keeps the cursor on the same line.' },
    ],
    expected: '1\n2\n3',
    task: 'Print 1 through 10 from main() in Java.',
    checkpoint: 'Run it. The JDK compiles first, then you should see 1 through 10.',
  },
};
