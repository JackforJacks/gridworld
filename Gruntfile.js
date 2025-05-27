module.exports = function(grunt) {
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        browserify: {
            'build/bundle.js': ['js/main.js'] // Output to build/bundle.js, use js/main.js as entry
        },
        watch: {
            options: {
                livereload: true
            },
            tasks: ['browserify'],
            files: ['src/*.js', 'main.js', 'js/browserify.js', 'index.html', 'styles.css', 'Gruntfile.js']
        },
    });


    grunt.loadNpmTasks('grunt-contrib-watch');
    grunt.loadNpmTasks('grunt-browserify');


};
