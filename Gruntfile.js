module.exports = function(grunt) {
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        browserify: {
            dist: {
                files: {
                    'build/bundle.js': ['js/hexaSphereGlobal.js', 'js/main.js'] // Include hexaSphereGlobal first to ensure proper global exposure
                }
            }
        },
        watch: {
            scripts: {
                files: ['src/**/*.js', 'js/**/*.js', 'index.html', 'styles.css', 'Gruntfile.js'],
                tasks: ['browserify'],
                options: {
                    livereload: true
                }
            }
        }
    });

    // Load the plugins
    grunt.loadNpmTasks('grunt-contrib-watch');
    grunt.loadNpmTasks('grunt-browserify');

    // Register tasks
    grunt.registerTask('build', ['browserify']);
    grunt.registerTask('default', ['build', 'watch']);
};
