# WXAPKG Decryptor

> A tool to decrypt the mini-app file, which content starts with "V1MMWX"

## Usage

* Copy your waiting-to-decrypt file to this directory, and name it as "\_\_APP\_\_.wxapkg"
* If you have wxapp-id (`wx****************` format), this method thanks to [BlackTrace](https://github.com/BlackTrace/pc_wxapkg_decrypt)
  * change `AppName` variable in `src/blackTrace.js`
  * run the following command

``` bash
yarn decompile
# or
node src/blackTrace.js
```

* Or if you don't have wxapp-id, these's a way to brute-force

``` bash
yarn legacy
# or
node src/index.js
```