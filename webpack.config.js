const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CompressionPlugin = require('compression-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  const isWatching = argv.watch || process.env.WEBPACK_WATCH;

  return {
    entry: './src/index.js',

    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isProduction ? '[name].[contenthash].js' : '[name].js',
      clean: !isWatching // Don't clean on watch mode for faster rebuilds
    },

    // Watch mode configuration
    watchOptions: {
      aggregateTimeout: 300, // Delay rebuild after first change (ms)
      poll: 1000, // Check for changes every second (useful for network drives)
      ignored: /node_modules/, // Ignore node_modules for better performance
    },

    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }, {
          test: /\.css$/,
          use: [
            // Use style-loader in development for faster CSS injection, MiniCssExtractPlugin in production
            isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
            'css-loader'
          ]
        },
        {
          test: /\.(png|jpg|jpeg|gif|svg)$/,
          type: 'asset/resource',
          generator: {
            filename: 'images/[name].[hash][ext]'
          }
        },
        {
          test: /\.(woff|woff2|eot|ttf|otf)$/,
          type: 'asset/resource',
          generator: {
            filename: 'fonts/[name].[hash][ext]'
          }
        }
      ]
    },
    plugins: [
      new CleanWebpackPlugin(),

      new HtmlWebpackPlugin({
        template: './index.html',
        filename: 'index.html',
        inject: 'head',
        scriptLoading: 'defer' // Changed from 'blocking' to 'defer'
      }),
      // Always include MiniCssExtractPlugin
      new MiniCssExtractPlugin({
        filename: isProduction ? '[name].[contenthash].css' : '[name].css', // Simpler name for dev
        chunkFilename: isProduction ? '[id].[contenthash].css' : '[id].css' // Simpler name for dev
      }),
      ...(isProduction ? [
        // Production-only plugins like CompressionPlugin were here
        new CompressionPlugin({
          algorithm: 'gzip',
          test: /\.(js|css|html|svg)$/,
          threshold: 8192,
          minRatio: 0.8
        })
      ] : []), new CopyWebpackPlugin({
        patterns: [
          // Only copy CSS in production mode, in dev mode webpack handles it via style-loader
          ...(isProduction ? [{
            from: 'css',
            to: 'css',
            globOptions: {
              ignore: ['**/*.map']
            }
          }] : []),
          {
            from: 'include/FileSaver.min.js', // Only copy FileSaver, not three.min.js
            to: 'include/FileSaver.min.js'
          },
          {
            from: 'equirectangle_projection.png',
            to: 'equirectangle_projection.png'
          }
        ]
      })
    ], devServer: {
      static: {
        directory: path.join(__dirname, 'dist'),
      },
      port: 8080,
      hot: true,
      open: true,
      liveReload: true,
      watchFiles: {
        paths: ['src/**/*', 'css/**/*', 'index.html'],
        options: {
          usePolling: false,
          interval: 1000,
        },
      },
      client: {
        logging: 'info',
        overlay: {
          errors: true,
          warnings: false,
        },
        progress: true,
      }, proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          timeout: 30000,
          proxyTimeout: 30000,
        },
        '/socket.io': {
          target: 'http://localhost:3000',
          ws: true,
          changeOrigin: true,
          timeout: 30000,
          proxyTimeout: 30000,
          logLevel: 'debug',
          onError: (err, req, res) => {
            console.log('WebSocket proxy error:', err.message);
          },
          onProxyReqWs: (proxyReq, req, socket) => {
            socket.on('error', (err) => {
              console.log('WebSocket socket error:', err.message);
            });
          },
          headers: {
            'Connection': 'keep-alive',
          },
        },
      },
    },

    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@components': path.resolve(__dirname, 'src/components'),
        '@managers': path.resolve(__dirname, 'src/managers'),
        '@utils': path.resolve(__dirname, 'src/utils'),
        '@sphere': path.resolve(__dirname, 'src/Sphere')
      }
    },
    devtool: isProduction ? 'source-map' : 'eval-source-map',

    // Increase performance warning limits and add optimizations
    performance: {
      hints: isProduction ? 'warning' : false,
      maxEntrypointSize: 1000000, // 1MB
      maxAssetSize: 1000000 // 1MB
    }, optimization: {
      splitChunks: {
        chunks: 'all',
        minSize: 10000,
        maxSize: 250000, // Keep chunks under 250KB for better performance
        cacheGroups: {
          three: {
            test: /[\\/]node_modules[\\/]three[\\/]/,
            name: 'three',
            chunks: 'all',
            priority: 30,
            reuseExistingChunk: true
          },
          socketio: {
            test: /[\\/]node_modules[\\/]socket\.io/,
            name: 'socketio',
            chunks: 'all',
            priority: 25,
            reuseExistingChunk: true
          },
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all',
            priority: 10,
            reuseExistingChunk: true
          },
          common: {
            name: 'common',
            minChunks: 2,
            chunks: 'all',
            priority: 5,
            reuseExistingChunk: true
          }
        }
      },
      ...(isProduction && {
        minimize: true,
        minimizer: [
          new TerserPlugin({
            terserOptions: {
              compress: {
                drop_console: true,
                drop_debugger: true
              }
            }
          })
        ],
        usedExports: true,
        sideEffects: false
      })
    }
  };
};
