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
      in
      {
        checks = {
          inherit pre-commit-check;
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
