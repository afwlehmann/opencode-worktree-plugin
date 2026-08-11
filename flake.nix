{
  description = "Git worktree management plugin for opencode";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    git-hooks.url = "github:cachix/git-hooks.nix";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      git-hooks,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        inherit (pkgs) lib;

        pre-commit-check = git-hooks.lib.${system}.run {
          src = ./.;
          hooks = {
            nixfmt.enable = true;
            prettier.enable = true;
            eslint = {
              enable = true;
              package = pkgs.eslint;
            };
          };
        };

        package = pkgs.buildNpmPackage {
          pname = "opencode-worktree-plugin";
          version = "0.2.2";
          src = ./.;
          npmDepsHash = "sha256-udTHE/ZAZyefLuW8SMTeW56FwNBfIxzQmDYrg3TfJA0=";
          npmDepsFetcherVersion = 2;
          makeCacheWritable = true;
          npmFlags = [ "--legacy-peer-deps" ];
          nodejs = pkgs.nodejs_22;
          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r dist $out/dist
            cp package.json $out/package.json
            runHook postInstall
          '';
          doInstallCheck = true;
          installCheckPhase = ''
            runHook preInstallCheck
            test -f $out/dist/index.js
            test -f $out/dist/tui.js
            test -f $out/package.json
            runHook postInstallCheck
          '';
          meta = {
            description = "Git worktree management plugin for opencode";
            license = lib.licenses.mit;
            platforms = lib.platforms.all;
          };
        };
      in
      {
        packages.default = package;

        checks = {
          inherit pre-commit-check;
          package-build = package;
        };

        devShells.default = pkgs.mkShell {
          inherit (pre-commit-check) shellHook;
          buildInputs =
            with pkgs;
            [
              nodejs_22
              git
              gh
              nixfmt
            ]
            ++ pre-commit-check.enabledPackages;
        };
      }
    );
}
