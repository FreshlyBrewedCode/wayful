{
  description = "Wayful — dev shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # nixpkgs trails Bun upstream by a minor or two, and the CLI's entrypoint
      # gates on >=1.4.1 — so the shell pins the official release binary rather
      # than pkgs.bun. To bump: change `version`, then refresh each hash with
      #   nix store prefetch-file --hash-type sha256 \
      #     https://github.com/oven-sh/bun/releases/download/bun-v<version>/bun-<target>.zip
      version = "1.4.2";
      targets = {
        x86_64-linux = { target = "linux-x64"; hash = "sha256-NjaPrvdSeHXV/6UuU81IAhdB8qg+tiCKjdZAaNQiqRM="; };
        aarch64-linux = { target = "linux-aarch64"; hash = "sha256-VDKLvC2cjgyfiSxUTWbFeoO4QTnjSQnl7oF1jxrI/ac="; };
        x86_64-darwin = { target = "darwin-x64"; hash = "sha256-gFINfhdSYwjJGF0mFnmsbSd5jTgDoOn3/5Ehq4r/sBI="; };
        aarch64-darwin = { target = "darwin-aarch64"; hash = "sha256-kJh6OhbX21VtiGrD1VHnttPt8KHPQ6yu1iLoZ2vh0S8="; };
      };

      mkBun = pkgs:
        let spec = targets.${pkgs.stdenv.hostPlatform.system};
        in
        pkgs.stdenv.mkDerivation {
          pname = "bun";
          inherit version;

          src = pkgs.fetchurl {
            url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-${spec.target}.zip";
            inherit (spec) hash;
          };

          nativeBuildInputs = [ pkgs.unzip ]
            ++ pkgs.lib.optional pkgs.stdenv.hostPlatform.isLinux pkgs.autoPatchelfHook;
          buildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.stdenv.cc.cc.lib ];

          # The release zips ship a single prebuilt executable.
          dontBuild = true;
          dontConfigure = true;
          sourceRoot = "bun-${spec.target}";

          installPhase = ''
            runHook preInstall
            install -Dm755 bun "$out/bin/bun"
            ln -s bun "$out/bin/bunx"
            runHook postInstall
          '';

          meta = {
            description = "Incredibly fast JavaScript runtime, bundler, transpiler and package manager";
            homepage = "https://bun.sh";
            mainProgram = "bun";
            platforms = builtins.attrNames targets;
            sourceProvenance = [ pkgs.lib.sourceTypes.binaryNativeCode ];
          };
        };
    in
    {
      packages = forAllSystems (pkgs: {
        bun = mkBun pkgs;
        default = mkBun pkgs;
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          # Node is only needed for npm: semantic-release shells out to it, and
          # the launcher (packages/cli/bin/wayful.js) is meant to run under real
          # Node, not just Bun's Node-compatible runtime. nodejs_24 (not _22) is
          # deliberate — its bundled npm is >=11.5.1, which is what npm trusted
          # publishing requires; an older npm falls back to token auth and fails
          # with an error that never mentions OIDC.
          packages = [ (mkBun pkgs) pkgs.nodejs_24 ];

          shellHook = ''
            echo "wayful devshell — bun $(bun --version), node $(node --version), npm $(npm --version)"
          '';
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixpkgs-fmt);
    };
}
