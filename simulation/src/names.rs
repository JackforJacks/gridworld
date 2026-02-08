//! Name Generation for People
//!
//! Provides simple random name generation with predefined lists.

use rand::Rng;

/// Common first names for males
const MALE_FIRST_NAMES: &[&str] = &[
    "James", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph",
    "Thomas", "Charles", "Christopher", "Daniel", "Matthew", "Anthony", "Mark",
    "Donald", "Steven", "Paul", "Andrew", "Joshua", "Kenneth", "Kevin", "Brian",
    "George", "Edward", "Ronald", "Timothy", "Jason", "Jeffrey", "Ryan", "Jacob",
    "Gary", "Nicholas", "Eric", "Stephen", "Jonathan", "Larry", "Justin", "Scott",
    "Brandon", "Benjamin", "Samuel", "Frank", "Gregory", "Raymond", "Alexander",
    "Patrick", "Jack", "Dennis", "Jerry", "Tyler", "Aaron", "Jose", "Adam",
    "Henry", "Nathan", "Douglas", "Zachary", "Peter", "Kyle", "Walter", "Ethan",
    "Jeremy", "Harold", "Keith", "Christian", "Roger", "Noah", "Gerald", "Carl",
];

/// Common first names for females
const FEMALE_FIRST_NAMES: &[&str] = &[
    "Mary", "Patricia", "Jennifer", "Linda", "Barbara", "Elizabeth", "Susan",
    "Jessica", "Sarah", "Karen", "Nancy", "Lisa", "Betty", "Margaret", "Sandra",
    "Ashley", "Dorothy", "Kimberly", "Emily", "Donna", "Michelle", "Carol",
    "Amanda", "Melissa", "Deborah", "Stephanie", "Rebecca", "Laura", "Sharon",
    "Cynthia", "Kathleen", "Amy", "Shirley", "Angela", "Helen", "Anna", "Brenda",
    "Pamela", "Nicole", "Emma", "Samantha", "Katherine", "Christine", "Debra",
    "Rachel", "Catherine", "Carolyn", "Janet", "Ruth", "Maria", "Heather",
    "Diane", "Virginia", "Julie", "Joyce", "Victoria", "Olivia", "Kelly",
    "Christina", "Lauren", "Joan", "Evelyn", "Judith", "Megan", "Cheryl", "Andrea",
];

/// Common last names
const LAST_NAMES: &[&str] = &[
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
    "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
    "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson",
    "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker",
    "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill",
    "Flores", "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell",
    "Mitchell", "Carter", "Roberts", "Gomez", "Phillips", "Evans", "Turner",
    "Diaz", "Parker", "Cruz", "Edwards", "Collins", "Reyes", "Stewart", "Morris",
    "Morales", "Murphy", "Cook", "Rogers", "Gutierrez", "Ortiz", "Morgan", "Cooper",
    "Peterson", "Bailey", "Reed", "Kelly", "Howard", "Ramos", "Kim", "Cox",
    "Ward", "Richardson", "Watson", "Brooks", "Chavez", "Wood", "James", "Bennett",
    "Gray", "Mendoza", "Ruiz", "Hughes", "Price", "Alvarez", "Castillo", "Sanders",
];

/// Generate a random first name based on sex
pub fn random_first_name(is_male: bool) -> &'static str {
    let mut rng = rand::thread_rng();
    if is_male {
        MALE_FIRST_NAMES[rng.gen_range(0..MALE_FIRST_NAMES.len())]
    } else {
        FEMALE_FIRST_NAMES[rng.gen_range(0..FEMALE_FIRST_NAMES.len())]
    }
}

/// Generate a random last name
pub fn random_last_name() -> &'static str {
    let mut rng = rand::thread_rng();
    LAST_NAMES[rng.gen_range(0..LAST_NAMES.len())]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_name_generation() {
        let first = random_first_name(true);
        assert!(MALE_FIRST_NAMES.contains(&first));

        let first = random_first_name(false);
        assert!(FEMALE_FIRST_NAMES.contains(&first));

        let last = random_last_name();
        assert!(LAST_NAMES.contains(&last));
    }
}
