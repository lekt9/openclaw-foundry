{
  description = "Foundry - Self-writing meta-extension for OpenClaw that forges new capabilities";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # Package metadata
        pname = "foundry";
        version = "0.2.0";

        # Build the plugin package
        foundry = pkgs.buildNpmPackage {
          inherit pname version;
          src = ./.;

          npmDepsHash = "sha256-ptuc/+svTyyuzjcNDkYmzWMqINGvCD4rUpmW4iX0BhE=";

          nodejs = pkgs.nodejs_22;

          # Fix npm cache write issues
          makeCacheWritable = true;

          buildPhase = ''
            # No build step needed - TypeScript runs via tsx at runtime
            true
          '';

          installPhase = ''
            mkdir -p $out/lib/openclaw/plugins/foundry

            # Copy plugin files
            cp index.ts $out/lib/openclaw/plugins/foundry/
            cp openclaw.plugin.json $out/lib/openclaw/plugins/foundry/
            cp package.json $out/lib/openclaw/plugins/foundry/

            # Copy source files
            if [ -d src ]; then
              cp -r src $out/lib/openclaw/plugins/foundry/
            fi

            # Copy node_modules
            cp -r node_modules $out/lib/openclaw/plugins/foundry/

            # Copy skill
            mkdir -p $out/lib/openclaw/skills
            cp -r skills/foundry $out/lib/openclaw/skills/
          '';

          meta = with pkgs.lib; {
            description = "Self-writing meta-extension for OpenClaw";
            homepage = "https://github.com/openclaw/foundry";
            license = licenses.mit;
            platforms = platforms.unix;
          };
        };

      in {
        packages = {
          default = foundry;
          foundry = foundry;
        };

        # Development shell
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            nodePackages.typescript
            nodePackages.npm
          ];
        };

        # nix-openclaw plugin contract
        # See: https://github.com/openclaw/nix-openclaw
        openclawPlugin = {
          name = "foundry";

          # Paths to SKILL.md directories
          skills = [
            "${foundry}/lib/openclaw/skills/foundry"
          ];

          # CLI packages to put on PATH (none for this plugin)
          packages = [];

          # Requirements
          needs = {
            stateDirs = [ ".openclaw/foundry" ];
            requiredEnv = [];
          };
        };
      }
    );
}
