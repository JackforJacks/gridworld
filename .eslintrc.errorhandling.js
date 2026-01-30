module.exports = {
    "rules": {
        // Enforce proper error handling - no empty catch blocks
        "no-empty": ["error", { 
            "allowEmptyCatch": false 
        }],
        
        // Require descriptive error parameter names (not _ or e)
        "id-match": ["warn", "^(?!(_|e)$).*", {
            "onlyDeclarations": true,
            "properties": false
        }],
        
        // Encourage proper error handling patterns
        "no-unused-vars": ["error", { 
            "args": "after-used",
            "argsIgnorePattern": "^_(?!$)", // Allow _foo but not bare _
            "caughtErrors": "all",
            "caughtErrorsIgnorePattern": "^_(?!$)"
        }]
    }
};
