const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  
  return {
    entry: './src/main.js',
    
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isProduction ? '[name].[contenthash].js' : '[name].js',
      clean: true
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
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader']
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
        inject: 'body'
      }),
      
      new CopyWebpackPlugin({
        patterns: [
          {
            from: 'css',
            to: 'css',
            globOptions: {
              ignore: ['**/*.map']
            }
          },
          {
            from: 'include',
            to: 'include',
            globOptions: {
              ignore: ['**/*.map']
            }
          },
          {
            from: 'equirectangle_projection.png',
            to: 'equirectangle_projection.png'
          }
        ]
      })
    ],
      devServer: {
      static: {
        directory: path.join(__dirname, 'dist')
      },
      port: 3000,
      open: true,
      hot: true,
      liveReload: true,
      watchFiles: ['src/**/*', 'css/**/*', 'index.html']
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
    
    optimization: {
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all'
          }
        }
      }
    }
  };
};
